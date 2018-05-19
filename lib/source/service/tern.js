"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../../model/source");
const ipcService_1 = require("../../model/ipcService");
const constant_1 = require("../../constant");
const buffers_1 = require("../../buffers");
const path = require("path");
const util_1 = require("../../util");
const logger = require('../../util/logger')('source-tern');
const modulePath = path.join(constant_1.ROOT, 'bin/tern.js');
class Tern extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'tern',
            shortcut: 'TERN',
            priority: 8,
            filetypes: ['javascript']
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.service = new ipcService_1.default(modulePath);
            this.service.start();
            yield util_1.wait(100);
            logger.info('starting tern server');
        });
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
            let { bufnr, filepath, linenr, line, col, colnr, input } = opt;
            let { content } = buffers_1.default.document;
            let { nvim, menu } = this;
            if (input.length && line[colnr - 2] !== '.') {
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
}
exports.default = Tern;
//# sourceMappingURL=tern.js.map