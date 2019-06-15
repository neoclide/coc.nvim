"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const util_1 = require("./util");
const workspace_1 = tslib_1.__importDefault(require("./workspace"));
const manager_1 = tslib_1.__importDefault(require("./snippets/manager"));
const vscode_uri_1 = require("vscode-uri");
const logger = require('./util/logger')('commands');
class CommandItem {
    constructor(id, impl, thisArg, internal = false) {
        this.id = id;
        this.impl = impl;
        this.thisArg = thisArg;
        this.internal = internal;
    }
    execute(...args) {
        let { impl, thisArg } = this;
        return impl.apply(thisArg, args || []);
    }
    dispose() {
        this.thisArg = null;
        this.impl = null;
    }
}
class CommandManager {
    constructor() {
        this.commands = new Map();
        this.titles = new Map();
    }
    init(nvim, plugin) {
        this.register({
            id: 'vscode.open',
            execute: async (url) => {
                nvim.call('coc#util#open_url', url.toString(), true);
            }
        }, true);
        this.register({
            id: 'workbench.action.reloadWindow',
            execute: () => {
                nvim.command('CocRestart', true);
            }
        }, true);
        this.register({
            id: 'editor.action.insertSnippet',
            execute: async (edit) => {
                let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
                if (!doc)
                    return;
                await nvim.call('coc#_cancel', []);
                if (doc.dirty)
                    doc.forceSync();
                await manager_1.default.insertSnippet(edit.newText, true, edit.range);
            }
        }, true);
        this.register({
            id: 'editor.action.doCodeAction',
            execute: async (action) => {
                await plugin.cocAction('doCodeAction', action);
            }
        }, true);
        this.register({
            id: 'editor.action.triggerSuggest',
            execute: async () => {
                await util_1.wait(100);
                nvim.call('coc#start', [], true);
            }
        }, true);
        this.register({
            id: 'editor.action.triggerParameterHints',
            execute: async () => {
                await util_1.wait(60);
                await plugin.cocAction('showSignatureHelp');
            }
        }, true);
        this.register({
            id: 'editor.action.restart',
            execute: async () => {
                await util_1.wait(30);
                nvim.command('CocRestart', true);
            }
        }, true);
        this.register({
            id: 'editor.action.showReferences',
            execute: async (_filepath, _position, references) => {
                await workspace_1.default.showLocations(references);
            }
        }, true);
        this.register({
            id: 'editor.action.rename',
            execute: async (uri, position) => {
                await workspace_1.default.jumpTo(uri, position);
                await plugin.cocAction('rename');
            }
        }, true);
        this.register({
            id: 'editor.action.format',
            execute: async () => {
                await plugin.cocAction('format');
            }
        }, true);
        this.register({
            id: 'workspace.diffDocument',
            execute: async () => {
                let document = await workspace_1.default.document;
                if (!document)
                    return;
                let lines = document.content.split('\n');
                await nvim.call('coc#util#diff_content', [lines]);
            }
        }, true);
        this.register({
            id: 'workspace.clearWatchman',
            execute: async () => {
                await workspace_1.default.runCommand('watchman watch-del-all');
            }
        });
        this.register({
            id: 'workspace.workspaceFolders',
            execute: async () => {
                let folders = workspace_1.default.workspaceFolders;
                let lines = folders.map(folder => vscode_uri_1.URI.parse(folder.uri).fsPath);
                await workspace_1.default.echoLines(lines);
            }
        });
        this.register({
            id: 'workspace.renameCurrentFile',
            execute: async () => {
                await workspace_1.default.renameCurrent();
            }
        });
        this.register({
            id: 'workspace.showOutput',
            execute: async (name) => {
                if (name) {
                    workspace_1.default.showOutputChannel(name);
                }
                else {
                    let names = workspace_1.default.channelNames;
                    if (names.length == 0)
                        return;
                    if (names.length == 1) {
                        workspace_1.default.showOutputChannel(names[0]);
                    }
                    else {
                        let idx = await workspace_1.default.showQuickpick(names);
                        if (idx == -1)
                            return;
                        let name = names[idx];
                        workspace_1.default.showOutputChannel(name);
                    }
                }
            }
        });
    }
    get commandList() {
        let res = [];
        for (let item of this.commands.values()) {
            if (!item.internal)
                res.push(item);
        }
        return res;
    }
    dispose() {
        for (const registration of this.commands.values()) {
            registration.dispose();
        }
        this.commands.clear();
    }
    execute(command) {
        let args = [command.command];
        let arr = command.arguments;
        if (arr)
            args.push(...arr);
        this.executeCommand.apply(this, args);
    }
    register(command, internal = false) {
        for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
            this.registerCommand(id, command.execute, command, internal);
        }
        return command;
    }
    has(id) {
        return this.commands.has(id);
    }
    unregister(id) {
        let item = this.commands.get(id);
        if (!item)
            return;
        item.dispose();
        this.commands.delete(id);
    }
    /**
     * Registers a command that can be invoked via a keyboard shortcut,
     * a menu item, an action, or directly.
     *
     * Registering a command with an existing command identifier twice
     * will cause an error.
     *
     * @param command A unique identifier for the command.
     * @param impl A command handler function.
     * @param thisArg The `this` context used when invoking the handler function.
     * @return Disposable which unregisters this command on disposal.
     */
    registerCommand(id, impl, thisArg, internal = false) {
        if (/^_/.test(id))
            internal = true;
        this.commands.set(id, new CommandItem(id, impl, thisArg, internal));
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.commands.delete(id);
        });
    }
    /**
     * Executes the command denoted by the given command identifier.
     *
     * * *Note 1:* When executing an editor command not all types are allowed to
     * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
     * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`URI`](#URI) and [`Location`](#Location).
     * * *Note 2:* There are no restrictions when executing commands that have been contributed
     * by extensions.
     *
     * @param command Identifier of the command to execute.
     * @param rest Parameters passed to the command function.
     * @return A promise that resolves to the returned value of the given command. `undefined` when
     * the command handler function doesn't return anything.
     */
    executeCommand(command, ...rest) {
        let cmd = this.commands.get(command);
        if (!cmd) {
            workspace_1.default.showMessage(`Command: ${command} not found`, 'error');
            return;
        }
        return Promise.resolve(cmd.execute.apply(cmd, rest)).catch(e => {
            workspace_1.default.showMessage(`Command error: ${e.message}`, 'error');
            logger.error(e.stack);
        });
    }
    async repeatCommand() {
        let mru = workspace_1.default.createMru('commands');
        let mruList = await mru.load();
        let first = mruList[0];
        if (first) {
            await this.executeCommand(first);
            await workspace_1.default.nvim.command(`silent! call repeat#set("\\<Plug>(coc-command-repeat)", -1)`);
        }
    }
}
exports.CommandManager = CommandManager;
exports.default = new CommandManager();
//# sourceMappingURL=commands.js.map