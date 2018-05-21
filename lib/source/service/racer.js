"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const stdioService_1 = require("../../model/stdioService");
const source_1 = require("../../model/source");
const buffers_1 = require("../../buffers");
const util_1 = require("../../util");
const fs_1 = require("../../util/fs");
const which = require("which");
const logger = require('../../util/logger')('source-racer');
const typeMap = {
    Struct: 'S', Module: 'M', Function: 'F',
    Crate: 'C', Let: 'V', StructField: 'M',
    Impl: 'I', Enum: 'E', EnumVariant: 'E',
    Type: 't', FnArg: 'v', Trait: 'T',
    Const: 'c'
};
class Racer extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'racer',
            shortcut: 'RACER',
            priority: 8,
            filetypes: ['rust'],
            command: 'racer',
        });
        this.disabled = false;
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command } = this.config;
            if (command === 'racer') {
                try {
                    which.sync('racer');
                }
                catch (e) {
                    yield util_1.echoWarning(this.nvim, 'Could not find gocode in $PATH');
                    this.disabled = true;
                    return;
                }
            }
            this.service = new stdioService_1.default(command, ['daemon']);
            this.service.start();
            logger.info('starting racer server');
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
            let { id, bufnr, filepath, linenr, col, input } = opt;
            let { nvim, menu } = this;
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let { content } = buffers_1.default.document;
            let tmpfname = yield fs_1.createTmpFile(content);
            let cmd = `complete-with-snippet ${linenr} ${col} "${filepath}" ${tmpfname}`;
            let output = yield this.service.request(cmd);
            let lines = output.split(/\r?\n/);
            let items = [];
            for (let line of lines) {
                if (!/^MATCH/.test(line))
                    continue;
                line = line.slice(6);
                let completion = line.split(';');
                let kind = typeMap[completion[5]] || '';
                let item = {
                    kind,
                    word: completion[0],
                    abbr: completion[1],
                };
                let doc = completion.slice(7).join(';').trim();
                doc = doc.replace(/^"/, '').replace(/"$/, '');
                doc = doc.replace(/\\n/g, '\n').replace(/\\;/g, ';');
                if (doc)
                    item.info = doc;
                items.push(item);
            }
            return {
                items: items.map(item => {
                    return Object.assign({}, item, { menu: item.menu ? `${item.menu} ${menu}` : menu });
                })
            };
        });
    }
}
exports.default = Racer;
//# sourceMappingURL=racer.js.map