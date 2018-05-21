"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const buffer_1 = require("./model/buffer");
const document_1 = require("./model/document");
const config_1 = require("./config");
const constant_1 = require("./constant");
const fs_1 = require("./util/fs");
const logger = require('./util/logger')('buffers');
let checkdFiles = [];
class Buffers {
    constructor() {
        this.buffers = [];
        this.versions = {};
    }
    getVersion(uri) {
        let version = this.versions[uri];
        version = version ? version + 1 : 1;
        this.versions[uri] = version;
        return version;
    }
    createDocument(nvim, opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let ts = Date.now();
            let { filetype, bufnr, iskeyword } = opt;
            let uri = `buffer://${bufnr}`;
            let content = yield this.loadBufferContent(nvim, bufnr);
            let version = this.getVersion(uri);
            let doc = new document_1.default(uri, filetype, version, content, iskeyword);
            this.document = doc;
            logger.debug(`Content load cost: ${Date.now() - ts}`);
        });
    }
    getFileDocument(nvim, filepath, filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufnr = yield nvim.call('bufnr', [filepath]);
            let buffer = this.buffers.find(buf => buf.bufnr == bufnr);
            let content;
            if (buffer) {
                content = buffer.content;
            }
            else {
                // read file
                content = yield fs_1.readFile(filepath, 'utf8');
            }
            let uri = `buffer://${bufnr}`;
            let version = this.getVersion(uri);
            return vscode_languageserver_types_1.TextDocument.create(uri, filetype, version, content);
        });
    }
    addBuffer(nvim, bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let buf = this.buffers.find(buf => buf.bufnr == bufnr);
            let checkGit = config_1.getConfig('checkGit');
            if (!buf && checkGit) {
                let fullpath = yield nvim.call('coc#util#get_fullpath', [bufnr]);
                if (checkdFiles.indexOf(fullpath) !== -1) {
                    let ignored = yield fs_1.isGitIgnored(fullpath);
                    if (ignored)
                        return;
                    checkdFiles.push(fullpath);
                }
            }
            let content = yield this.loadBufferContent(nvim, bufnr);
            if (/\u0000/.test(content) || !content)
                return;
            let keywordOption = yield nvim.call('getbufvar', [bufnr, '&iskeyword']);
            if (buf) {
                buf.setContent(content);
            }
            else {
                this.buffers.push(new buffer_1.default(bufnr, content, keywordOption));
            }
        });
    }
    loadBufferContent(nvim, bufnr, timeout = 1000) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let count = yield nvim.call('nvim_buf_line_count', [bufnr]);
            if (count > constant_1.MAX_CODE_LINES)
                return null;
            return yield nvim.call('coc#util#get_content', [bufnr]);
        });
    }
    removeBuffer(bufnr) {
        let idx = this.buffers.findIndex(o => o.bufnr == bufnr);
        if (idx !== -1) {
            this.buffers.splice(idx, 1);
        }
    }
    getWords(bufnr) {
        let words = [];
        for (let buf of this.buffers) {
            if (bufnr == buf.bufnr)
                continue;
            for (let word of buf.words) {
                if (words.indexOf(word) == -1) {
                    words.push(word);
                }
            }
        }
        return words;
    }
    getBuffer(bufnr) {
        let buf = this.buffers.find(o => o.bufnr == bufnr);
        return buf || null;
    }
    refresh(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufs = yield nvim.call('coc#util#get_buflist', []);
            this.buffers = [];
            for (let buf of bufs) {
                yield this.addBuffer(nvim, buf);
            }
            checkdFiles = [];
            logger.info('Buffers refreshed');
        });
    }
}
exports.Buffers = Buffers;
const buffers = new Buffers();
exports.default = buffers;
//# sourceMappingURL=buffers.js.map