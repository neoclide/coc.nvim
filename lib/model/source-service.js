"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("./source");
const index_1 = require("../util/index");
class ServiceSource extends source_1.default {
    previewMessage(msg) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return this.nvim.call('coc#util#preview_info', [msg]);
        });
    }
    echoMessage(line) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            yield nvim.command(`echohl MoreMsg | echomsg '${index_1.escapeSingleQuote(line)}' | echohl None"`);
        });
    }
    promptList(items) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let msgs = ['Choose by number:'];
            msgs = msgs.concat(items.map((str, index) => {
                return `${index + 1}) ${str}`;
            }));
            return yield this.nvim.call('input', [msgs.join('\n') + '\n']);
        });
    }
    echoLines(lines) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let cmdHeight = yield nvim.getOption('cmdheight');
            if (lines.length > cmdHeight) {
                lines = lines.slice(0, cmdHeight);
                let last = lines[cmdHeight - 1];
                lines[cmdHeight - 1] = `${last} ...`;
            }
            let str = lines.join('\\n').replace(/"/g, '\\"');
            yield nvim.command(`echo "${str}"`);
        });
    }
    findType(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, name } = this;
            yield index_1.echoWarning(nvim, `find type not supported by ${name}`);
        });
    }
    showDocuments(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, name } = this;
            yield index_1.echoWarning(nvim, `show documents not supported by ${name}`);
        });
    }
    jumpDefinition(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, name } = this;
            yield index_1.echoWarning(nvim, `jump definition not supported by ${name}`);
        });
    }
    showSignature(query) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, name } = this;
            yield index_1.echoWarning(nvim, `show signature not supported by ${name}`);
        });
    }
}
exports.default = ServiceSource;
//# sourceMappingURL=source-service.js.map