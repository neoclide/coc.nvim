"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path = require("path");
const source_service_1 = require("../../model/source-service");
const stdioService_1 = require("../../model/stdioService");
const constant_1 = require("../../constant");
const workspace_1 = require("../../workspace");
const util_1 = require("../../util");
const cp = require("child_process");
const string_1 = require("../../util/string");
const logger = require('../../util/logger')('source-jedi');
const execPath = path.join(constant_1.ROOT, 'bin/jedi_server.py');
const boolSettings = [
    'use_filesystem_cache',
    'fast_parser',
    'dynamic_params_for_other_modules',
    'dynamic_array_additions',
    'dynamic_params'
];
class Jedi extends source_service_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'jedi',
            shortcut: 'JD',
            filetypes: ['python'],
            command: 'python',
            showSignature: true,
            bindKeywordprg: true,
        });
        this.disabled = false;
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command, settings, preloads } = this.config;
            let { nvim } = this;
            try {
                cp.execSync(`${command} -c "import jedi"`);
            }
            catch (e) {
                yield util_1.echoErr(nvim, `${command} could not import jedi`);
                this.disabled = true;
                return;
            }
            let service = this.service = new stdioService_1.default(command, [execPath]);
            service.start();
            if (settings) {
                for (let key of Object.keys(settings)) {
                    if (boolSettings.indexOf(key) !== -1) {
                        settings[key] = util_1.toBool(settings[key]);
                    }
                }
                yield service.request(JSON.stringify({
                    action: 'settings',
                    settings
                }));
            }
            if (preloads && preloads.length) {
                yield service.request(JSON.stringify({
                    action: 'preload',
                    modules: preloads
                }));
            }
            logger.info('jedi server started');
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype) || this.disabled)
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
            let content = workspace_1.default.getDocument(bufnr).content;
            let { menu } = this;
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let result = yield this.service.request(JSON.stringify({
                action: 'complete',
                line: linenr,
                col,
                filename: filepath,
                content
            }));
            let items = [];
            try {
                items = JSON.parse(result);
            }
            catch (e) {
                logger.error(`Bad result from jedi ${result}`);
            }
            return {
                items: items.map(item => {
                    return Object.assign({}, item, { menu: item.menu ? `${item.menu} ${menu}` : menu });
                })
            };
        });
    }
    //   public async showDefinition(query:QueryOption):Promise<void> {
    //   }
    showDocuments(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filename, lnum, col, content } = query;
            let result = yield this.service.request(JSON.stringify({
                action: 'doc',
                line: lnum,
                col,
                filename,
                content
            }));
            if (result) {
                let texts = JSON.parse(result);
                if (texts.length) {
                    yield this.previewMessage(texts.join('\n'));
                }
                else {
                    yield this.echoMessage('Not found');
                }
            }
        });
    }
    jumpDefinition(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filename, lnum, col, content } = query;
            let result = yield this.service.request(JSON.stringify({
                action: 'definition',
                line: lnum,
                col,
                filename,
                content
            }));
            let list = JSON.parse(result);
            if (list.length == 1) {
                let { lnum, filename, col } = list[0];
                yield this.nvim.call('coc#util#jump_to', [filename, lnum - 1, col - 1]);
            }
            else {
                let msgs = list.map(o => `${o.filename}:${o.lnum}:${col}`);
                let n = yield this.promptList(msgs);
                let idx = parseInt(n, 10);
                if (idx && list[idx - 1]) {
                    let { lnum, filename, col } = list[idx - 1];
                    yield this.nvim.call('coc#util#jump_to', [filename, lnum - 1, col - 1]);
                }
            }
        });
    }
    showSignature(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filename, lnum, col, content } = query;
            let line = yield this.nvim.call('getline', ['.']);
            let uidx = string_1.unicodeIndex(line, col);
            let before = line.slice(0, uidx);
            let after = line.slice(uidx);
            if (col <= 1)
                return;
            if (/\.\w+$/.test(before) && /\w*\(/.test(after)) {
                col = col + after.indexOf('(') + 1;
            }
            let result = yield this.service.request(JSON.stringify({
                action: 'signature',
                line: lnum,
                col,
                filename,
                content
            }));
            try {
                let list = JSON.parse(result);
                let lines = list.map(item => {
                    return `${item.func}(${item.params.join(',')})`;
                });
                yield this.echoLines(lines);
            }
            catch (e) {
                yield this.echoMessage('Not found');
            }
        });
    }
}
exports.default = Jedi;
//# sourceMappingURL=jedi.js.map