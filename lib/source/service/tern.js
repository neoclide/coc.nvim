"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_service_1 = require("../../model/source-service");
const ipcService_1 = require("../../model/ipcService");
const constant_1 = require("../../constant");
const buffers_1 = require("../../buffers");
const path = require("path");
const util_1 = require("../../util");
const findRoot = require("find-root");
const fs = require("fs");
const opn = require("opn");
const logger = require('../../util/logger')('source-tern');
const modulePath = path.join(constant_1.ROOT, 'bin/tern.js');
const ternRoot = path.join(constant_1.ROOT, 'node_modules/tern');
class Tern extends source_service_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'tern',
            shortcut: 'TERN',
            priority: 8,
            filetypes: ['javascript'],
            // path of tern module
            ternRoot,
            // debug port for node
            debugPort: null,
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { ternRoot, debugPort, showSignature, bindKeywordprg } = this.config;
            let { nvim } = this;
            let cwd = yield nvim.call('getcwd');
            let root = this.root = this.findProjectRoot(cwd);
            let execArgv = debugPort ? [`--inspect=${debugPort}`] : [];
            this.service = new ipcService_1.default(modulePath, root, execArgv, [ternRoot]);
            this.service.start();
            yield this.bindEvents();
            logger.info('starting tern server');
        });
    }
    findProjectRoot(cwd) {
        try {
            return findRoot(cwd, dir => {
                return fs.existsSync(path.join(dir, '.tern-project'));
            });
        }
        catch (e) {
            return cwd;
        }
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype))
                return false;
            if (!this.service || !this.service.isRunnning) {
                yield this.onInit();
            }
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, filepath, linenr, col, input } = opt;
            let { content } = buffers_1.default.document;
            let { nvim, menu } = this;
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let items = yield this.service.request({
                action: 'complete',
                line: linenr - 1,
                col,
                filename: filepath,
                content
            });
            return {
                items: items.map(item => {
                    return Object.assign({}, item, { menu: item.menu ? `${item.menu} ${menu}` : menu });
                })
            };
        });
    }
    showDefinition(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let { filename, lnum, col, content } = query;
            let res = yield this.service.request({
                action: 'type',
                filename,
                line: lnum - 1,
                col,
                content
            });
            let { exprName, name } = res;
            let msg = `${exprName || name || ''}: ${res.type}`;
            yield this.echoMessage(msg);
        });
    }
    showDocuments(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let { filename, lnum, col, content } = query;
            let res = yield this.service.request({
                action: 'type',
                filename,
                line: lnum - 1,
                col,
                content
            });
            let { name, exprName, doc, url } = res;
            if (doc) {
                let texts = [`## ${exprName || name}`];
                texts = texts.concat(doc.split(/\r?\n/));
                if (url)
                    texts.push(`\nSee: ${url}`);
                yield this.previewMessage(texts.join('\n'));
            }
            else if (url) {
                yield opn(url);
            }
            else {
                yield this.echoMessage('Not found');
            }
        });
    }
    jumpDefinition(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let { filename, lnum, filetype, col, content } = query;
            let res = yield this.service.request({
                action: 'definition',
                filename,
                line: lnum - 1,
                col,
                content
            });
            let { file, url, start } = res;
            if (file) {
                let filepath = path.resolve(this.root, file);
                let doc = yield buffers_1.default.getFileDocument(nvim, filepath, filetype);
                let pos = doc.positionAt(start);
                yield nvim.call('coc#util#jump_to', [filepath, pos.line, pos.character]);
            }
            else if (url) {
                yield opn(url);
            }
            else {
                yield this.echoMessage('Not found');
            }
        });
    }
    showSignature(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let { filename, lnum, col, content } = query;
            let line = yield nvim.call('getline', ['.']);
            let part = line.slice(0, col);
            let fname;
            let ms = part.match(/\.(\w+)\([^(]*$/);
            if (ms) {
                fname = ms[1];
                col = ms.index + 1;
            }
            else if (/\.\w+$/.test(part)) {
                fname = yield nvim.call('expand', ['<cword>']);
            }
            if (fname) {
                let res = yield this.service.request({
                    action: 'type',
                    preferFunction: true,
                    filename,
                    line: lnum - 1,
                    col,
                    content
                });
                let t = res.type;
                if (t && /^fn/.test(t)) {
                    yield nvim.command('echo ""');
                    yield nvim.command(`echo '${util_1.escapeSingleQuote(fname + ': ' + t)}'`);
                    return;
                }
            }
        });
    }
}
exports.default = Tern;
//# sourceMappingURL=tern.js.map