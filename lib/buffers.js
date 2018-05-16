"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const buffer_1 = require("./model/buffer");
const document_1 = require("./model/document");
const unique = require("array-unique");
const config_1 = require("./config");
const fs_1 = require("./util/fs");
const logger = require('./util/logger')('buffers');
let checkdFiles = [];
class Buffers {
    constructor() {
        this.buffers = [];
        this.versions = {};
    }
    createDocument(uri, filetype, content, keywordOption) {
        let version = this.versions[uri];
        version = version ? version + 1 : 1;
        this.versions[uri] = version;
        let doc = new document_1.default(uri, filetype, version, content, keywordOption);
        this.document = doc;
        return doc;
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
            let content = '';
            if (count > 2000) {
                // file too big, read file from disk
                let filepath = yield nvim.call('coc#util#get_fullpath', [bufnr]);
                if (!filepath)
                    return;
                let stat = yield fs_1.statAsync(filepath);
                if (!stat)
                    return;
                let encoding = yield nvim.call('getbufvar', [bufnr, '&fileencoding']);
                content = yield fs_1.readFile(filepath, encoding, timeout);
            }
            else {
                let lines = yield nvim.call('nvim_buf_get_lines', [bufnr, 0, -1, 0]);
                content = lines.join('\n');
            }
            return content;
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
            words = words.concat(buf.words);
        }
        return unique(words);
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