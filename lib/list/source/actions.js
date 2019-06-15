"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const commands_1 = tslib_1.__importDefault(require("../../commands"));
const manager_1 = tslib_1.__importDefault(require("../../diagnostic/manager"));
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const services_1 = tslib_1.__importDefault(require("../../services"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
const logger = require('../../util/logger')('list-actions');
class ActionsList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'do';
        this.description = 'code actions of selected range.';
        this.name = 'actions';
        this.options = [{
                name: '-start',
                description: 'start of line',
                hasValue: true
            }, {
                name: '-end',
                description: 'end of line',
                hasValue: true
            }, {
                name: '-quickfix',
                description: 'quickfix only',
            }, {
                name: '-source',
                description: 'source action only'
            }];
        this.addAction('do', async (item) => {
            let action = item.data.action;
            let { command, edit } = action;
            if (edit)
                await workspace_1.default.applyEdit(edit);
            if (command) {
                if (commands_1.default.has(command.command)) {
                    commands_1.default.execute(command);
                }
                else {
                    let clientId = action.clientId;
                    let service = services_1.default.getService(clientId);
                    let params = {
                        command: command.command,
                        arguments: command.arguments
                    };
                    if (service.client) {
                        let { client } = service;
                        client
                            .sendRequest(vscode_languageserver_protocol_1.ExecuteCommandRequest.type, params)
                            .then(undefined, error => {
                            workspace_1.default.showMessage(`Execute '${command.command} error: ${error}'`, 'error');
                        });
                    }
                }
            }
        });
    }
    async loadItems(context) {
        let buf = await context.window.buffer;
        let doc = workspace_1.default.getDocument(buf.id);
        if (!doc)
            return null;
        let args = this.parseArguments(context.args);
        let range;
        if (args.start && args.end) {
            range = vscode_languageserver_protocol_1.Range.create(parseInt(args.start, 10) - 1, 0, parseInt(args.end, 10), 0);
        }
        else {
            range = vscode_languageserver_protocol_1.Range.create(0, 0, doc.lineCount, 0);
        }
        let diagnostics = manager_1.default.getDiagnosticsInRange(doc.textDocument, range);
        let actionContext = { diagnostics };
        if (args.quickfix) {
            actionContext.only = [vscode_languageserver_protocol_1.CodeActionKind.QuickFix];
        }
        else if (args.source) {
            actionContext.only = [vscode_languageserver_protocol_1.CodeActionKind.Source];
        }
        let codeActionsMap = await languages_1.default.getCodeActions(doc.textDocument, range, actionContext);
        if (!codeActionsMap)
            return [];
        let codeActions = [];
        for (let clientId of codeActionsMap.keys()) {
            let actions = codeActionsMap.get(clientId);
            for (let action of actions) {
                codeActions.push(Object.assign({ clientId }, action));
            }
        }
        codeActions.sort((a, b) => {
            if (a.isPrefered && !b.isPrefered) {
                return -1;
            }
            if (b.isPrefered && !a.isPrefered) {
                return 1;
            }
            return 0;
        });
        let items = codeActions.map(action => {
            return {
                label: `${action.title} ${action.clientId ? `[${action.clientId}]` : ''} ${action.kind ? `(${action.kind})` : ''}`,
                data: { action }
            };
        });
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocActionsTitle /\\v^[^[]+/ contained containedin=CocActionsLine', true);
        nvim.command('syntax match CocActionsClient /\\[\\w\\+\\]/ contained containedin=CocActionsLine', true);
        nvim.command('syntax match CocActionsKind /\\v\\(.*\\)$/ contained containedin=CocActionsLine', true);
        nvim.command('highlight default link CocActionsTitle Normal', true);
        nvim.command('highlight default link CocActionsClient Typedef', true);
        nvim.command('highlight default link CocActionsKind Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = ActionsList;
//# sourceMappingURL=actions.js.map