"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const buffer_1 = require("./model/buffer");
const document_1 = require("./model/document");
const index_1 = require("./util/index");
const logger_1 = require("./util/logger");
const unique = require("array-unique");
class Buffers {
    constructor() {
        this.buffers = [];
        this.versions = {};
    }
    createDocument(uri, filetype, content, keywordOption) {
        let version = this.versions[uri];
        version = version ? version + 1 : 1;
        this.versions[uri] = version;
        let keywordRegStr = index_1.getKeywordsRegStr(keywordOption);
        logger_1.logger.debug(`str:${keywordRegStr}`);
        let doc = new document_1.default(uri, filetype, version, content, keywordRegStr);
        logger_1.logger.debug(`abc`);
        this.document = doc;
        return doc;
    }
    addBuffer(bufnr, content, keywordOption) {
        let buf = this.buffers.find(buf => buf.bufnr === bufnr);
        if (buf) {
            buf.setContent(content);
        }
        else {
            let keywordRegStr = index_1.getKeywordsRegStr(keywordOption);
            this.buffers.push(new buffer_1.default(bufnr, content, keywordRegStr));
        }
    }
    removeBuffer(bufnr) {
        let idx = this.buffers.findIndex(o => o.bufnr === bufnr);
        if (idx !== -1) {
            this.buffers.splice(idx, 1);
        }
    }
    getWords(bufnr) {
        let words = [];
        for (let buf of this.buffers) {
            if (bufnr === buf.bufnr)
                continue;
            words = words.concat(buf.words);
        }
        return unique(words);
    }
    getBuffer(bufnr) {
        let buf = this.buffers.find(o => o.bufnr == bufnr);
        return buf || null;
    }
}
exports.Buffers = Buffers;
const buffers = new Buffers();
exports.default = buffers;
//# sourceMappingURL=buffers.js.map