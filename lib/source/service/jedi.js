"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path = require("path");
const source_1 = require("../../model/source");
const stdioService_1 = require("../../model/stdioService");
const constant_1 = require("../../constant");
const buffers_1 = require("../../buffers");
const util_1 = require("../../util");
const cp = require("child_process");
const logger = require('../../util/logger')('source-jedi');
const execPath = path.join(constant_1.ROOT, 'bin/jedi_server.py');
class Jedi extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'jedi',
            shortcut: 'JD',
            priority: 8,
            filetypes: ['python'],
            command: 'python',
        });
        this.disabled = false;
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command } = this.config;
            try {
                cp.execSync(`${command} -c "import jedi"`);
            }
            catch (e) {
                yield util_1.echoWarning(this.nvim, `${command} could not import jedi`);
                this.disabled = true;
                return;
            }
            this.service = new stdioService_1.default(command, [execPath]);
            this.service.start();
            yield util_1.wait(100);
            logger.info('starting jedi server');
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype, input, line, colnr } = opt;
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
            let { content } = buffers_1.default.document;
            let { nvim, menu } = this;
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let items = yield this.service.request({
                action: 'complete',
                line: linenr,
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
exports.default = Jedi;
//# sourceMappingURL=jedi.js.map