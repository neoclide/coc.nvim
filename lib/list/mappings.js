"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require("../util/extensions");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const configuration_1 = require("./configuration");
const logger = require('../util/logger')('list-mappings');
class Mappings {
    constructor(manager, nvim, config) {
        this.manager = manager;
        this.nvim = nvim;
        this.config = config;
        this.insertMappings = new Map();
        this.normalMappings = new Map();
        this.userInsertMappings = new Map();
        this.userNormalMappings = new Map();
        let { prompt } = manager;
        this.add('insert', '<C-k>', () => {
            prompt.removeTail();
        });
        this.add('insert', '<C-n>', () => {
            manager.history.next();
        });
        this.add('insert', '<C-p>', () => {
            manager.history.previous();
        });
        this.add('insert', '<C-s>', () => {
            return manager.switchMatcher();
        });
        this.add('insert', ['<C-m>', '<cr>'], async () => {
            await manager.doAction();
        });
        this.add('insert', ['<tab>', '<C-i>', '\t'], () => {
            return manager.chooseAction();
        });
        this.add('insert', '<C-o>', () => {
            manager.toggleMode();
        });
        this.add('insert', '<C-c>', async () => {
            manager.stop();
            manager.prompt.start();
            return;
        });
        this.add('insert', '<esc>', () => {
            return manager.cancel();
        });
        this.add('insert', '<C-l>', async () => {
            await manager.worker.loadItems(true);
        });
        this.add('insert', '<left>', () => {
            prompt.moveLeft();
        });
        this.add('insert', '<right>', () => {
            prompt.moveRight();
        });
        this.add('insert', ['<end>', '<C-e>'], () => {
            prompt.moveToEnd();
        });
        this.add('insert', ['<home>', '<C-a>'], () => {
            prompt.moveToStart();
        });
        this.add('insert', ['<C-h>', '<bs>'], () => {
            prompt.onBackspace();
        });
        this.add('insert', '<C-w>', () => {
            prompt.removeWord();
        });
        this.add('insert', '<C-u>', () => {
            prompt.removeAhead();
        });
        this.add('insert', '<C-d>', () => {
            return manager.feedkeys('<C-d>');
        });
        this.add('insert', '<PageUp>', () => {
            return manager.feedkeys('<PageUp>');
        });
        this.add('insert', '<PageDown>', () => {
            return manager.feedkeys('<PageDown>');
        });
        this.add('insert', '<down>', () => {
            return manager.normal('j');
        });
        this.add('insert', '<up>', () => {
            return manager.normal('k');
        });
        this.add('insert', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'));
        this.add('insert', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'));
        this.add('insert', ['<C-f>'], this.doScroll.bind(this, '<C-f>'));
        this.add('insert', ['<C-b>'], this.doScroll.bind(this, '<C-b>'));
        this.add('normal', '<C-o>', () => {
            // do nothing, avoid buffer switch by accident
        });
        this.add('normal', 't', () => {
            return manager.doAction('tabe');
        });
        this.add('normal', 's', () => {
            return manager.doAction('split');
        });
        this.add('normal', 'd', () => {
            return manager.doAction('drop');
        });
        this.add('normal', ['<cr>', '<C-m>', '\r'], () => {
            return manager.doAction();
        });
        this.add('normal', '<C-a>', () => {
            return manager.ui.selectAll();
        });
        this.add('normal', ' ', () => {
            return manager.ui.toggleSelection();
        });
        this.add('normal', 'p', () => {
            return manager.togglePreview();
        });
        this.add('normal', ['<tab>', '\t', '<C-i>'], () => {
            return manager.chooseAction();
        });
        this.add('normal', '<C-c>', () => {
            manager.stop();
        });
        this.add('normal', '<esc>', () => {
            return manager.cancel();
        });
        this.add('normal', '<C-l>', () => {
            return manager.worker.loadItems(true);
        });
        this.add('normal', ['i', 'I', 'o', 'O', 'a', 'A'], () => {
            return manager.toggleMode();
        });
        this.add('normal', '?', () => {
            return manager.showHelp();
        });
        this.add('normal', ':', async () => {
            await manager.cancel(false);
            await nvim.eval('feedkeys(":")');
        });
        this.add('normal', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'));
        this.add('normal', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'));
        let insertMappings = this.manager.getConfig('insertMappings', {});
        this.userInsertMappings = this.fixUserMappings(insertMappings);
        let normalMappings = this.manager.getConfig('normalMappings', {});
        this.userNormalMappings = this.fixUserMappings(normalMappings);
        workspace_1.default.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('list')) {
                let config = workspace_1.default.getConfiguration('list');
                let insertMappings = config.get('insertMappings', {});
                this.userInsertMappings = this.fixUserMappings(insertMappings);
                let normalMappings = config.get('normalMappings', {});
                this.userNormalMappings = this.fixUserMappings(normalMappings);
            }
        });
    }
    fixUserMappings(mappings) {
        let res = new Map();
        for (let [key, value] of Object.entries(mappings)) {
            if (key.length == 1) {
                res.set(key, value);
            }
            else if (key.startsWith('<') && key.endsWith('>')) {
                if (configuration_1.validKeys.indexOf(key) != -1) {
                    res.set(key, value);
                }
                else {
                    let find = false;
                    // tslint:disable-next-line: prefer-for-of
                    for (let i = 0; i < configuration_1.validKeys.length; i++) {
                        if (configuration_1.validKeys[i].toLowerCase() == key.toLowerCase()) {
                            find = true;
                            res.set(configuration_1.validKeys[i], value);
                            break;
                        }
                    }
                    if (!find)
                        workspace_1.default.showMessage(`Invalid mappings key: ${key}`, 'error');
                }
            }
            else {
                // tslint:disable-next-line: no-console
                workspace_1.default.showMessage(`Invalid mappings key: ${key}`, 'error');
            }
        }
        return res;
    }
    async doInsertKeymap(key) {
        let nextKey = this.config.nextKey;
        let previousKey = this.config.previousKey;
        if (key == nextKey) {
            await this.manager.normal('j');
            return true;
        }
        if (key == previousKey) {
            await this.manager.normal('k');
            return true;
        }
        let expr = this.userInsertMappings.get(key);
        if (expr) {
            await this.evalExpression(expr, 'insert');
            return true;
        }
        if (this.insertMappings.has(key)) {
            let fn = this.insertMappings.get(key);
            await Promise.resolve(fn());
            return true;
        }
        return false;
    }
    async doNormalKeymap(key) {
        let expr = this.userNormalMappings.get(key);
        if (expr) {
            await this.evalExpression(expr, 'normal');
            return true;
        }
        if (this.normalMappings.has(key)) {
            let fn = this.normalMappings.get(key);
            await Promise.resolve(fn());
            return true;
        }
        return false;
    }
    add(mode, key, fn) {
        let mappings = mode == 'insert' ? this.insertMappings : this.normalMappings;
        if (Array.isArray(key)) {
            for (let k of key) {
                mappings.set(k, fn);
            }
        }
        else {
            mappings.set(key, fn);
        }
    }
    async onError(msg) {
        let { nvim } = this;
        await nvim.call('coc#list#stop_prompt', []);
        workspace_1.default.showMessage(msg, 'error');
        this.manager.prompt.start();
    }
    async evalExpression(expr, _mode) {
        if (typeof expr != 'string' || expr.indexOf(':') == -1) {
            await this.onError(`Invalid expression ${expr}`);
            return;
        }
        let { manager } = this;
        let { prompt } = manager;
        let [key, action] = expr.split(':', 2);
        if (key == 'do') {
            switch (action) {
                case 'switch':
                    await manager.switchMatcher();
                    return;
                case 'selectall':
                    await manager.ui.selectAll();
                    return;
                case 'help':
                    await manager.showHelp();
                    return;
                case 'refresh':
                    await manager.worker.loadItems();
                    return;
                case 'exit':
                    await manager.cancel(true);
                    return;
                case 'stop':
                    manager.stop();
                    return;
                case 'cancel':
                    await manager.cancel(false);
                    return;
                case 'toggle':
                    await manager.ui.toggleSelection();
                    return;
                case 'previous':
                    await manager.normal('k');
                    return;
                case 'next':
                    await manager.normal('j');
                    return;
                case 'defaultaction':
                    await manager.doAction();
                    return;
                default:
                    await this.onError(`'${action}' not supported`);
            }
        }
        else if (key == 'prompt') {
            switch (action) {
                case 'previous':
                    manager.history.previous();
                    return;
                case 'next':
                    manager.history.next();
                    return;
                case 'start':
                    return prompt.moveToStart();
                case 'end':
                    return prompt.moveToEnd();
                case 'left':
                    return prompt.moveLeft();
                case 'right':
                    return prompt.moveRight();
                case 'deleteforward':
                    return prompt.onBackspace();
                case 'deletebackward':
                    return prompt.removeNext();
                case 'removetail':
                    return prompt.removeTail();
                case 'removeahead':
                    return prompt.removeAhead();
                case 'paste':
                    await prompt.paste();
                    return;
                default:
                    await this.onError(`prompt '${action}' not supported`);
            }
        }
        else if (key == 'command') {
            await manager.command(action);
        }
        else if (key == 'action') {
            await manager.doAction(action);
        }
        else if (key == 'feedkeys') {
            await manager.feedkeys(action);
        }
        else if (key == 'normal') {
            await manager.normal(action, false);
        }
        else if (key == 'normal!') {
            await manager.normal(action, true);
        }
        else if (key == 'call') {
            await manager.call(action);
        }
        else if (key == 'expr') {
            let name = await manager.call(action);
            if (name)
                await manager.doAction(name);
        }
        else {
            await this.onError(`Invalid expression ${expr}`);
        }
    }
    async doScroll(key) {
        await this.manager.feedkeys(key);
    }
}
exports.default = Mappings;
//# sourceMappingURL=mappings.js.map