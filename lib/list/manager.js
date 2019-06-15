"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const events_1 = tslib_1.__importDefault(require("../events"));
const extensions_1 = tslib_1.__importDefault(require("../extensions"));
const util_1 = require("../util");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const configuration_1 = tslib_1.__importDefault(require("./configuration"));
const history_1 = tslib_1.__importDefault(require("./history"));
const mappings_1 = tslib_1.__importDefault(require("./mappings"));
const prompt_1 = tslib_1.__importDefault(require("./prompt"));
const commands_1 = tslib_1.__importDefault(require("./source/commands"));
const diagnostics_1 = tslib_1.__importDefault(require("./source/diagnostics"));
const extensions_2 = tslib_1.__importDefault(require("./source/extensions"));
const folders_1 = tslib_1.__importDefault(require("./source/folders"));
const links_1 = tslib_1.__importDefault(require("./source/links"));
const lists_1 = tslib_1.__importDefault(require("./source/lists"));
const location_1 = tslib_1.__importDefault(require("./source/location"));
const outline_1 = tslib_1.__importDefault(require("./source/outline"));
const output_1 = tslib_1.__importDefault(require("./source/output"));
const services_1 = tslib_1.__importDefault(require("./source/services"));
const sources_1 = tslib_1.__importDefault(require("./source/sources"));
const symbols_1 = tslib_1.__importDefault(require("./source/symbols"));
const actions_1 = tslib_1.__importDefault(require("./source/actions"));
const ui_1 = tslib_1.__importDefault(require("./ui"));
const worker_1 = tslib_1.__importDefault(require("./worker"));
const logger = require('../util/logger')('list-manager');
const mouseKeys = ['<LeftMouse>', '<LeftDrag>', '<LeftRelease>', '<2-LeftMouse>'];
class ListManager {
    constructor() {
        this.plugTs = 0;
        this.disposables = [];
        this.args = [];
        this.listArgs = [];
        this.listMap = new Map();
        this.activated = false;
        this.executing = false;
    }
    init(nvim) {
        this.nvim = nvim;
        this.config = new configuration_1.default();
        this.prompt = new prompt_1.default(nvim, this.config);
        this.history = new history_1.default(this);
        this.mappings = new mappings_1.default(this, nvim, this.config);
        this.worker = new worker_1.default(nvim, this);
        this.ui = new ui_1.default(nvim, this.config);
        events_1.default.on('VimResized', () => {
            if (this.isActivated)
                nvim.command('redraw!', true);
        }, null, this.disposables);
        events_1.default.on('InputChar', this.onInputChar, this, this.disposables);
        events_1.default.on('FocusGained', debounce_1.default(async () => {
            if (this.activated)
                this.prompt.drawPrompt();
        }, 100), null, this.disposables);
        events_1.default.on('BufEnter', debounce_1.default(async () => {
            let { bufnr } = this.ui;
            if (!bufnr)
                return;
            if (!this.activated) {
                this.ui.hide();
                return;
            }
            let { isVim } = workspace_1.default;
            let curr = await nvim.call('bufnr', '%');
            if (curr == bufnr) {
                this.prompt.start();
                if (isVim)
                    nvim.command(`set t_ve=`, true);
            }
            else {
                nvim.pauseNotification();
                this.prompt.cancel();
                await nvim.resumeNotification();
            }
        }, 100), null, this.disposables);
        this.ui.onDidChangeLine(debounce_1.default(async () => {
            if (!this.activated)
                return;
            let previewing = await nvim.call('coc#util#has_preview');
            if (previewing)
                await this.doAction('preview');
        }, 100), null, this.disposables);
        this.ui.onDidLineChange(debounce_1.default(async () => {
            let { autoPreview } = this.listOptions;
            if (!autoPreview || !this.activated)
                return;
            await this.doAction('preview');
        }, 100), null, this.disposables);
        this.ui.onDidChangeLine(this.resolveItem, this, this.disposables);
        this.ui.onDidLineChange(this.resolveItem, this, this.disposables);
        this.ui.onDidOpen(() => {
            if (this.currList) {
                if (typeof this.currList.doHighlight == 'function') {
                    this.currList.doHighlight();
                }
            }
        }, null, this.disposables);
        this.ui.onDidClose(async () => {
            await this.cancel();
        }, null, this.disposables);
        this.ui.onDidChange(async () => {
            if (this.activated) {
                this.updateStatus();
            }
            this.prompt.drawPrompt();
        }, null, this.disposables);
        this.ui.onDidDoubleClick(async () => {
            await this.doAction();
        }, null, this.disposables);
        this.worker.onDidChangeItems(async ({ items, highlights, reload, append }) => {
            if (!this.activated)
                return;
            if (append) {
                this.ui.addHighlights(highlights, true);
                await this.ui.appendItems(items);
            }
            else {
                this.ui.addHighlights(highlights);
                await this.ui.drawItems(items, this.name, this.listOptions.position, reload);
            }
        }, null, this.disposables);
        this.registerList(new links_1.default(nvim));
        this.registerList(new location_1.default(nvim));
        this.registerList(new symbols_1.default(nvim));
        this.registerList(new outline_1.default(nvim));
        this.registerList(new commands_1.default(nvim));
        this.registerList(new extensions_2.default(nvim));
        this.registerList(new diagnostics_1.default(nvim));
        this.registerList(new sources_1.default(nvim));
        this.registerList(new services_1.default(nvim));
        this.registerList(new output_1.default(nvim));
        this.registerList(new lists_1.default(nvim, this.listMap));
        this.registerList(new folders_1.default(nvim));
        this.registerList(new actions_1.default(nvim));
    }
    async start(args) {
        if (this.activated)
            return;
        let res = this.parseArgs(args);
        if (!res)
            return;
        this.activated = true;
        this.args = [...res.listOptions, res.list.name, ...res.listArgs];
        let { list, options, listArgs } = res;
        try {
            this.reset();
            this.listOptions = options;
            this.currList = list;
            this.listArgs = listArgs;
            this.cwd = workspace_1.default.cwd;
            await this.getCharMap();
            await this.history.load();
            this.window = await this.nvim.window;
            this.prompt.start(options);
            await this.worker.loadItems();
        }
        catch (e) {
            await this.cancel();
            let msg = e instanceof Error ? e.message : e.toString();
            workspace_1.default.showMessage(`Error on "CocList ${list.name}": ${msg}`, 'error');
            logger.error(e);
        }
    }
    async resume() {
        let { name, ui, currList, nvim } = this;
        if (!currList)
            return;
        this.activated = true;
        this.window = await nvim.window;
        this.prompt.start();
        await ui.resume(name, this.listOptions.position);
    }
    async doAction(name) {
        let { currList } = this;
        name = name || currList.defaultAction;
        let action = currList.actions.find(o => o.name == name);
        if (!action) {
            workspace_1.default.showMessage(`Action ${name} not found`, 'error');
            return;
        }
        let items = await this.ui.getItems();
        if (items.length)
            await this.doItemAction(items, action);
    }
    async previous() {
        let { ui } = this;
        let item = ui.getItem(-1);
        if (!item)
            return;
        ui.index = ui.index - 1;
        await this.doItemAction([item], this.defaultAction);
        await ui.echoMessage(item);
    }
    async next() {
        let { ui } = this;
        let item = ui.getItem(1);
        if (!item)
            return;
        ui.index = ui.index + 1;
        await this.doItemAction([item], this.defaultAction);
        await ui.echoMessage(item);
    }
    async cancel(close = true) {
        let { nvim, ui } = this;
        if (!this.activated) {
            nvim.call('coc#list#stop_prompt', [], true);
            return;
        }
        this.activated = false;
        this.worker.stop();
        this.history.add();
        nvim.pauseNotification();
        nvim.command('pclose', true);
        this.prompt.cancel();
        if (close) {
            ui.hide();
            if (this.window) {
                let valid = await this.window.valid;
                if (valid)
                    nvim.call('win_gotoid', this.window.id, true);
            }
        }
        await nvim.resumeNotification();
    }
    async switchMatcher() {
        let { matcher, interactive } = this.listOptions;
        if (interactive)
            return;
        const list = ['fuzzy', 'strict', 'regex'];
        let idx = list.indexOf(matcher) + 1;
        if (idx >= list.length)
            idx = 0;
        this.listOptions.matcher = list[idx];
        this.prompt.matcher = list[idx];
        await this.worker.drawItems();
    }
    async togglePreview() {
        let { nvim } = this;
        let has = await nvim.call('coc#list#has_preview');
        if (has) {
            await nvim.command('pclose');
            await nvim.command('redraw');
        }
        else {
            await this.doAction('preview');
        }
    }
    async chooseAction() {
        let { nvim, currList } = this;
        if (!this.activated)
            return;
        let { actions, defaultAction } = currList;
        let names = actions.map(o => o.name);
        let idx = names.indexOf(defaultAction);
        if (idx != -1) {
            names.splice(idx, 1);
            names.unshift(defaultAction);
        }
        let shortcuts = new Set();
        let choices = [];
        for (let name of names) {
            let i = 0;
            for (let ch of name) {
                if (!shortcuts.has(ch)) {
                    shortcuts.add(ch);
                    choices.push(`${name.slice(0, i)}&${name.slice(i)}`);
                    break;
                }
                i++;
            }
        }
        await nvim.call('coc#list#stop_prompt');
        let n = await nvim.call('confirm', ['Choose action:', choices.join('\n')]);
        await util_1.wait(10);
        this.prompt.start();
        if (n)
            await this.doAction(names[n - 1]);
    }
    get name() {
        let { currList } = this;
        return currList ? currList.name : 'anonymous';
    }
    get list() {
        return this.currList;
    }
    parseArgs(args) {
        let options = [];
        let interactive = false;
        let autoPreview = false;
        let numberSelect = false;
        let name;
        let input = '';
        let matcher = 'fuzzy';
        let listArgs = [];
        let listOptions = [];
        for (let arg of args) {
            if (!name && arg.startsWith('-')) {
                listOptions.push(arg);
            }
            else if (!name) {
                if (!/^\w+$/.test(arg)) {
                    workspace_1.default.showMessage(`Invalid list option: "${arg}"`, 'error');
                    return null;
                }
                name = arg;
            }
            else {
                listArgs.push(arg);
            }
        }
        name = name || 'lists';
        let config = workspace_1.default.getConfiguration(`list.source.${name}`);
        if (!listOptions.length && !listArgs.length)
            listOptions = config.get('defaultOptions', []);
        if (!listArgs.length)
            listArgs = config.get('defaultArgs', []);
        for (let opt of listOptions) {
            if (opt.startsWith('--input')) {
                input = opt.slice(8);
            }
            else if (opt == '--number-select' || opt == '-N') {
                numberSelect = true;
            }
            else if (opt == '--auto-preview' || opt == '-A') {
                autoPreview = true;
            }
            else if (opt == '--regex' || opt == '-R') {
                matcher = 'regex';
            }
            else if (opt == '--strict' || opt == '-S') {
                matcher = 'strict';
            }
            else if (opt == '--interactive' || opt == '-I') {
                interactive = true;
            }
            else if (opt == '--ignore-case' || opt == '--top' || opt == '--normal' || opt == '--no-sort') {
                options.push(opt.slice(2));
            }
            else {
                workspace_1.default.showMessage(`Invalid option "${opt}" of list`, 'error');
                return null;
            }
        }
        let list = this.listMap.get(name);
        if (!list) {
            workspace_1.default.showMessage(`List ${name} not found`, 'error');
            return null;
        }
        if (interactive && !list.interactive) {
            workspace_1.default.showMessage(`Interactive mode of "${name}" not supported`, 'error');
            return null;
        }
        return {
            list,
            listArgs,
            listOptions,
            options: {
                numberSelect,
                autoPreview,
                input,
                interactive,
                matcher,
                ignorecase: options.indexOf('ignore-case') != -1 ? true : false,
                position: options.indexOf('top') == -1 ? 'bottom' : 'top',
                mode: options.indexOf('normal') == -1 ? 'insert' : 'normal',
                sort: options.indexOf('no-sort') == -1 ? true : false
            },
        };
    }
    updateStatus() {
        let { ui, currList, activated, nvim } = this;
        if (!activated)
            return;
        let buf = nvim.createBuffer(ui.bufnr);
        let status = {
            mode: this.prompt.mode.toUpperCase(),
            args: this.args.join(' '),
            name: currList.name,
            total: this.worker.length,
            cwd: this.cwd,
        };
        buf.setVar('list_status', status, true);
        if (ui.window)
            nvim.command('redraws', true);
    }
    async onInputChar(ch, charmod) {
        let { mode } = this.prompt;
        let mapped = this.charMap.get(ch);
        let now = Date.now();
        if (mapped == '<plug>' || now - this.plugTs < 2) {
            this.plugTs = now;
            return;
        }
        if (!ch)
            return;
        if (ch == '\x1b') {
            await this.cancel();
            return;
        }
        if (!this.activated) {
            this.nvim.call('coc#list#stop_prompt', [], true);
            return;
        }
        try {
            if (mode == 'insert') {
                await this.onInsertInput(ch, charmod);
            }
            else {
                await this.onNormalInput(ch, charmod);
            }
        }
        catch (e) {
            workspace_1.default.showMessage(`Error on input ${ch}: ${e}`);
            logger.error(e);
        }
    }
    async onInsertInput(ch, charmod) {
        let { nvim } = this;
        let inserted = this.charMap.get(ch) || ch;
        if (mouseKeys.indexOf(inserted) !== -1) {
            await this.onMouseEvent(inserted);
            return;
        }
        if (this.listOptions.numberSelect) {
            let code = ch.charCodeAt(0);
            if (code >= 48 && code <= 57) {
                let n = Number(ch);
                if (n == 0)
                    n = 10;
                if (this.ui.length >= n) {
                    nvim.pauseNotification();
                    this.ui.setCursor(Number(ch), 0);
                    await nvim.resumeNotification();
                    await this.doAction();
                }
                return;
            }
        }
        let done = await this.mappings.doInsertKeymap(inserted);
        if (done || charmod || this.charMap.has(ch))
            return;
        for (let s of ch) {
            let code = s.codePointAt(0);
            if (code == 65533)
                return;
            // exclude control characer
            if (code < 32 || code >= 127 && code <= 159)
                return;
            this.prompt.insertCharacter(s);
        }
    }
    async onNormalInput(ch, _charmod) {
        let inserted = this.charMap.get(ch) || ch;
        if (mouseKeys.indexOf(inserted) !== -1) {
            await this.onMouseEvent(inserted);
            return;
        }
        let done = await this.mappings.doNormalKeymap(inserted);
        if (!done)
            await this.feedkeys(inserted);
    }
    onMouseEvent(key) {
        switch (key) {
            case '<LeftMouse>':
                return this.ui.onMouse('mouseDown');
            case '<LeftDrag>':
                return this.ui.onMouse('mouseDrag');
            case '<LeftRelease>':
                return this.ui.onMouse('mouseUp');
            case '<2-LeftMouse>':
                return this.ui.onMouse('doubleClick');
        }
    }
    async feedkeys(key) {
        let { nvim } = this;
        key = key.startsWith('<') && key.endsWith('>') ? `\\${key}` : key;
        await nvim.call('coc#list#stop_prompt', []);
        await nvim.eval(`feedkeys("${key}")`);
        this.prompt.start();
    }
    async command(command) {
        let { nvim } = this;
        await nvim.call('coc#list#stop_prompt', []);
        await nvim.command(command);
        this.prompt.start();
    }
    async normal(command, bang = true) {
        let { nvim } = this;
        await nvim.call('coc#list#stop_prompt', []);
        await nvim.command(`normal${bang ? '!' : ''} ${command}`);
        this.prompt.start();
    }
    async call(fname) {
        if (!this.currList || !this.window)
            return;
        await this.nvim.call('coc#list#stop_prompt', []);
        let buf = await this.window.buffer;
        let targets = await this.ui.getItems();
        let context = {
            name: this.currList.name,
            args: this.listArgs,
            input: this.prompt.input,
            winid: this.window.id,
            bufnr: buf.id,
            targets
        };
        let res = await this.nvim.call(fname, [context]);
        this.prompt.start();
        return res;
    }
    async showHelp() {
        // echo help
        await this.cancel();
        let { list, nvim } = this;
        if (!list)
            return;
        let cmds = [];
        let echoHl = (msg, group) => {
            cmds.push(`echohl ${group} | echon "${msg.replace(/"/g, '\\"')}\\n" | echohl None`);
        };
        echoHl('NAME', 'Label');
        cmds.push(`echon "  ${list.name} - ${list.description || ''}\\n\\n"`);
        echoHl('SYNOPSIS', 'Label');
        cmds.push(`echon "  :CocList [LIST OPTIONS] ${list.name} [ARGUMENTS]\\n\\n"`);
        if (list.detail) {
            echoHl('DESCRIPTION', 'Label');
            let lines = list.detail.split('\n').map(s => '  ' + s);
            cmds.push(`echon "${lines.join('\\n')}"`);
            cmds.push(`echon "\\n"`);
        }
        if (list.options) {
            echoHl('ARGUMENTS', 'Label');
            cmds.push(`echon "\\n"`);
            for (let opt of list.options) {
                echoHl(opt.name, 'Special');
                cmds.push(`echon "  ${opt.description}"`);
                cmds.push(`echon "\\n\\n"`);
            }
        }
        let config = workspace_1.default.getConfiguration(`list.source.${list.name}`);
        if (Object.keys(config).length) {
            echoHl('CONFIGURATIONS', 'Label');
            cmds.push(`echon "\\n"`);
            let props = {};
            extensions_1.default.all.forEach(extension => {
                let { packageJSON } = extension;
                let { contributes } = packageJSON;
                if (!contributes)
                    return;
                let { configuration } = contributes;
                if (configuration) {
                    let { properties } = configuration;
                    if (properties) {
                        for (let key of Object.keys(properties)) {
                            props[key] = properties[key];
                        }
                    }
                }
            });
            for (let key of Object.keys(config)) {
                let val = config[key];
                let name = `list.source.${list.name}.${key}`;
                let description = props[name] && props[name].description ? props[name].description : '';
                cmds.push(`echohl MoreMsg | echon "'${name}'"| echohl None`);
                cmds.push(`echon " - "`);
                if (description)
                    cmds.push(`echon "${description}, "`);
                cmds.push(`echon "current value: ${JSON.stringify(val).replace(/"/g, '\\"')}"`);
                cmds.push(`echon "\\n"`);
            }
            cmds.push(`echon "\\n"`);
        }
        echoHl('ACTIONS', 'Label');
        cmds.push(`echon "\\n"`);
        cmds.push(`echon "  ${list.actions.map(o => o.name).join(', ')}\\n"`);
        cmds.push(`echon "\\n"`);
        cmds.push(`echon "see ':h coc-list--options' for available list options.\\n"`);
        nvim.call('coc#util#execute', cmds.join('|'), true);
    }
    get context() {
        return {
            options: this.listOptions,
            args: this.listArgs,
            input: this.prompt.input,
            window: this.window,
            listWindow: this.ui.window,
            cwd: this.cwd
        };
    }
    registerList(list) {
        const { name } = list;
        let exists = this.listMap.get(name);
        if (this.listMap.has(name)) {
            if (exists) {
                if (typeof exists.dispose == 'function') {
                    exists.dispose();
                }
                this.listMap.delete(name);
            }
            workspace_1.default.showMessage(`list "${name}" recreated.`);
        }
        this.listMap.set(name, list);
        extensions_1.default.addSchemeProperty(`list.source.${name}.defaultOptions`, {
            type: 'array',
            default: list.interactive ? ['--interactive'] : [],
            description: `Default list options of "${name}" list, only used when both list option and argument are empty.`,
            uniqueItems: true,
            items: {
                type: 'string',
                enum: ['--top', '--normal', '--no-sort', '--input',
                    '--strict', '--regex', '--ignore-case', '--number-select',
                    '--interactive', '--auto-preview']
            }
        });
        extensions_1.default.addSchemeProperty(`list.source.${name}.defaultArgs`, {
            type: 'array',
            default: [],
            description: `Default argument list of "${name}" list, only used when list argument is empty.`,
            uniqueItems: true,
            items: { type: 'string' }
        });
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            if (typeof list.dispose == 'function') {
                list.dispose();
            }
            this.listMap.delete(name);
        });
    }
    get names() {
        return Array.from(this.listMap.keys());
    }
    toggleMode() {
        let { mode } = this.prompt;
        this.prompt.mode = mode == 'normal' ? 'insert' : 'normal';
        this.updateStatus();
    }
    getConfig(key, defaultValue) {
        return this.config.get(key, defaultValue);
    }
    get isActivated() {
        return this.activated;
    }
    stop() {
        this.worker.stop();
    }
    reset() {
        this.window = null;
        this.listOptions = null;
        this.prompt.reset();
        this.worker.stop();
        this.ui.reset();
    }
    dispose() {
        if (this.config) {
            this.config.dispose();
        }
        util_1.disposeAll(this.disposables);
    }
    async getCharMap() {
        if (this.charMap)
            return;
        this.charMap = new Map();
        let chars = await this.nvim.call('coc#list#get_chars');
        Object.keys(chars).forEach(key => {
            this.charMap.set(chars[key], key);
        });
        return;
    }
    async doItemAction(items, action) {
        if (this.executing)
            return;
        this.executing = true;
        let { nvim } = this;
        let shouldCancel = action.persist !== true && action.name != 'preview';
        try {
            if (shouldCancel) {
                await this.cancel();
            }
            else if (action.name != 'preview') {
                await nvim.call('coc#list#stop_prompt');
            }
            if (!shouldCancel && !this.isActivated)
                return;
            if (action.multiple) {
                await Promise.resolve(action.execute(items, this.context));
            }
            else if (action.parallel) {
                await Promise.all(items.map(item => {
                    return Promise.resolve(action.execute(item, this.context));
                }));
            }
            else {
                for (let item of items) {
                    await Promise.resolve(action.execute(item, this.context));
                }
            }
            if (!shouldCancel) {
                if (!this.isActivated) {
                    this.nvim.command('pclose', true);
                    return;
                }
                if (action.name != 'preview') {
                    this.prompt.start();
                }
                await this.ui.restoreWindow();
                if (action.reload)
                    await this.worker.loadItems(true);
            }
        }
        catch (e) {
            // tslint:disable-next-line: no-console
            console.error(e);
            if (!shouldCancel && this.activated) {
                this.prompt.start();
            }
        }
        this.executing = false;
    }
    async resolveItem() {
        if (!this.activated)
            return;
        let index = this.ui.index;
        let item = this.ui.getItem(0);
        if (!item || item.resolved)
            return;
        let { list } = this;
        if (typeof list.resolveItem == 'function') {
            let resolved = await list.resolveItem(item);
            if (resolved && index == this.ui.index) {
                await this.ui.updateItem(resolved, index);
            }
        }
    }
    get defaultAction() {
        let { currList } = this;
        let { defaultAction } = currList;
        return currList.actions.find(o => o.name == defaultAction);
    }
}
exports.ListManager = ListManager;
exports.default = new ListManager();
//# sourceMappingURL=manager.js.map