"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const jsonc_parser_1 = require("jsonc-parser");
const vscode_uri_1 = require("vscode-uri");
const logger = require('../util/logger')('configuration-shape');
class ConfigurationProxy {
    constructor(workspace) {
        this.workspace = workspace;
    }
    get nvim() {
        return this.workspace.nvim;
    }
    async modifyConfiguration(target, key, value) {
        let { nvim, workspace } = this;
        let file = workspace.getConfigFile(target);
        if (!file)
            return;
        let formattingOptions = await workspace.getFormatOptions();
        let content = await workspace.readFile(vscode_uri_1.URI.file(file).toString());
        value = value == null ? undefined : value;
        let edits = jsonc_parser_1.modify(content, [key], value, { formattingOptions });
        content = jsonc_parser_1.applyEdits(content, edits);
        fs_1.default.writeFileSync(file, content, 'utf8');
        let doc = workspace.getDocument(vscode_uri_1.URI.file(file).toString());
        if (doc)
            nvim.command('checktime', true);
        return;
    }
    $updateConfigurationOption(target, key, value) {
        this.modifyConfiguration(target, key, value); // tslint:disable-line
    }
    $removeConfigurationOption(target, key) {
        this.modifyConfiguration(target, key); // tslint:disable-line
    }
}
exports.default = ConfigurationProxy;
//# sourceMappingURL=shape.js.map