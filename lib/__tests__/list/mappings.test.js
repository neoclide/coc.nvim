"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const basic_1 = tslib_1.__importDefault(require("../../list/basic"));
const manager_1 = tslib_1.__importDefault(require("../../list/manager"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
class TestList extends basic_1.default {
    constructor() {
        super(...arguments);
        this.name = 'test';
        this.timeout = 3000;
        this.text = 'test';
        this.detail = 'detail';
    }
    loadItems(_context, token) {
        return new Promise(resolve => {
            let timer = setTimeout(() => {
                resolve([{ label: this.text }]);
            }, this.timeout);
            token.onCancellationRequested(() => {
                if (timer) {
                    clearTimeout(timer);
                    resolve([]);
                }
            });
        });
    }
}
let nvim;
const locations = [{
        filename: __filename,
        col: 2,
        lnum: 1,
        text: 'foo'
    }, {
        filename: __filename,
        col: 1,
        lnum: 2,
        text: 'Bar'
    }, {
        filename: __filename,
        col: 1,
        lnum: 3,
        text: 'option'
    }];
const lineList = {
    name: 'lines',
    actions: [{
            name: 'open',
            execute: async (item) => {
                await workspace_1.default.moveTo({
                    line: item.data.line,
                    character: 0
                });
                // noop
            }
        }],
    defaultAction: 'open',
    async loadItems(_context, _token) {
        let lines = [];
        for (let i = 0; i < 100; i++) {
            lines.push(i.toString());
        }
        return lines.map((line, idx) => {
            return {
                label: line,
                data: { line: idx }
            };
        });
    }
};
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
    global.locations = locations;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await manager_1.default.cancel();
    await helper_1.default.reset();
});
describe('list insert mappings', () => {
    it('should cancel by <esc>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<esc>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(false);
    });
    it('should stop loading by <C-c>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<C-c>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(true);
    });
    it('should reload by <C-l>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<C-l>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(true);
    });
    it('should change to normal mode by <C-o>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<C-o>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(true);
        let line = await helper_1.default.getCmdline();
        expect(line).toBe('');
    });
    it('should select line by <down> and <up>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<down>", "in")');
        await helper_1.default.wait(50);
        await nvim.eval('feedkeys("\\<up>", "in")');
        await helper_1.default.wait(50);
        expect(manager_1.default.isActivated).toBe(true);
        let line = await nvim.line;
        expect(line).toMatch('foo');
    });
    it('should move cursor by <left> and <right>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<left>", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("a", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<right>", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("c", "in")');
        await helper_1.default.wait(10);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('afc');
    });
    it('should move cursor by <end> and <home>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<home>", "in")');
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<end>a", "in")');
        await helper_1.default.wait(30);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('a');
    });
    it('should move cursor by <PageUp> and <PageDown>', async () => {
        let disposable = manager_1.default.registerList(lineList);
        await manager_1.default.start(['lines']);
        await helper_1.default.wait(60);
        await nvim.eval('feedkeys("\\<PageDown>", "in")');
        await helper_1.default.wait(60);
        let line = await nvim.eval('line(".")');
        expect(line).toBeGreaterThan(1);
        await nvim.eval('feedkeys("\\<PageUp>", "in")');
        await helper_1.default.wait(60);
        disposable.dispose();
    });
    it('should scroll window by <C-f> and <C-b>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(200);
        await nvim.eval('feedkeys("\\<C-f>", "in")');
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<C-b>", "in")');
        await helper_1.default.wait(100);
    });
    it('should change input by <Backspace>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<Backspace>", "in")');
        await helper_1.default.wait(30);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('');
    });
    it('should change input by <C-h>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<C-h>", "in")');
        await helper_1.default.wait(30);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('');
    });
    it('should change input by <C-w>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("a", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<C-w>", "in")');
        await helper_1.default.wait(10);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('');
    });
    it('should change input by <C-u>', async () => {
        await manager_1.default.start(['--input=abc', 'location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<C-u>", "in")');
        await helper_1.default.wait(10);
        let input = manager_1.default.prompt.input;
        expect(input).toBe('');
    });
    it('should change input by <C-n> and <C-p>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<CR>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(false);
        await manager_1.default.start(['location']);
        await nvim.eval('feedkeys("\\<C-n>", "in")');
        await helper_1.default.wait(100);
        let input = manager_1.default.prompt.input;
        expect(input.length).toBeGreaterThan(0);
        await nvim.eval('feedkeys("\\<C-p>", "in")');
        await helper_1.default.wait(100);
        input = manager_1.default.prompt.input;
        expect(input.length).toBeGreaterThan(0);
    });
    it('should change matcher by <C-s>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<C-s>", "in")');
        await helper_1.default.wait(10);
        let matcher = manager_1.default.listOptions.matcher;
        expect(matcher).toBe('strict');
        await nvim.eval('feedkeys("\\<C-s>", "in")');
        await helper_1.default.wait(10);
        matcher = manager_1.default.listOptions.matcher;
        expect(matcher).toBe('regex');
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(30);
        let len = manager_1.default.ui.length;
        expect(len).toBeGreaterThan(0);
    });
    it('should select action by <tab>', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<tab>", "in")');
        await helper_1.default.wait(30);
        await nvim.input('t');
        await helper_1.default.wait(500);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(2);
    });
    it('should select action for visual selected items', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.input('V');
        await helper_1.default.wait(30);
        await nvim.input('2');
        await helper_1.default.wait(30);
        await nvim.input('j');
        await helper_1.default.wait(30);
        await manager_1.default.doAction('tabe');
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBeGreaterThan(3);
    });
});
describe('list normal mappings', () => {
    it('should cancel list by <esc>', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<esc>", "in")');
        await helper_1.default.wait(100);
        expect(manager_1.default.isActivated).toBe(false);
    });
    it('should stop task by <C-c>', async () => {
        let disposable = manager_1.default.registerList(new TestList(nvim));
        let p = manager_1.default.start(['--normal', 'test']);
        await helper_1.default.wait(30);
        await nvim.input('<C-c>');
        await helper_1.default.wait(100);
        await p;
        let len = manager_1.default.ui.length;
        expect(len).toBe(0);
        disposable.dispose();
    });
    it('should reload list by <C-l>', async () => {
        let list = new TestList(nvim);
        list.timeout = 0;
        let disposable = manager_1.default.registerList(list);
        await manager_1.default.start(['--normal', 'test']);
        await helper_1.default.wait(30);
        list.text = 'new';
        await nvim.input('<C-l>');
        await helper_1.default.wait(30);
        let line = await nvim.line;
        expect(line).toMatch('new');
        disposable.dispose();
    });
    it('should select all items by <C-a>', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.input('<C-a>');
        await helper_1.default.wait(30);
        let selected = manager_1.default.ui.selectedItems;
        expect(selected.length).toBe(locations.length);
    });
    it('should select action by <tab>', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<tab>", "in")');
        await helper_1.default.wait(30);
        await nvim.input('t');
        await helper_1.default.wait(30);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(2);
    });
    it('should toggle selection <space>', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<space>", "in")');
        await helper_1.default.wait(30);
        let selected = manager_1.default.ui.selectedItems;
        expect(selected.length).toBe(1);
        await nvim.eval('feedkeys("k", "in")');
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("\\<space>", "in")');
        await helper_1.default.wait(30);
        selected = manager_1.default.ui.selectedItems;
        expect(selected.length).toBe(0);
    });
    it('should change to insert mode by i, o, a', async () => {
        let keys = ['i', 'I', 'o', 'O', 'a', 'A'];
        for (let key of keys) {
            await manager_1.default.start(['--normal', 'location']);
            await helper_1.default.wait(30);
            await nvim.eval(`feedkeys("${key}", "in")`);
            await helper_1.default.wait(30);
            let mode = manager_1.default.prompt.mode;
            expect(mode).toBe('insert');
        }
    });
    it('should preview by p', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("p", "in")');
        await helper_1.default.wait(30);
        let winnr = await nvim.call('coc#util#has_preview');
        expect(winnr).toBe(2);
    });
    it('should show help by ?', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("?", "in")');
        await helper_1.default.wait(30);
        await nvim.input('<CR>');
    });
    it('should tabopen by t', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("t", "in")');
        await helper_1.default.wait(100);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(2);
    });
    it('should drop by d', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("d", "in")');
        await helper_1.default.wait(100);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(1);
    });
    it('should split by s', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(30);
        await nvim.eval('feedkeys("s", "in")');
        await helper_1.default.wait(100);
        let nr = await nvim.call('winnr');
        expect(nr).toBe(1);
    });
});
describe('User mappings', () => {
    it('should execute do mappings', async () => {
        helper_1.default.updateConfiguration('list.previousKeymap', '<c-j>');
        helper_1.default.updateConfiguration('list.nextKeymap', '<c-k>');
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-r>': 'do:refresh',
            '<C-a>': 'do:selectall',
            '<C-s>': 'do:switch',
            '<C-q>': 'do:cancel',
            '<C-t>': 'do:toggle',
            '<C-n>': 'do:next',
            '<C-p>': 'do:previous',
            '<C-x>': 'do:defaultaction',
            '<C-h>': 'do:help',
            '<C-d>': 'do:exit',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(200);
        await nvim.eval('feedkeys("\\<C-r>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(true);
        await nvim.eval('feedkeys("\\<C-a>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.ui.selectedItems.length).toBe(locations.length);
        await nvim.eval('feedkeys("\\<C-s>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.listOptions.matcher).toBe('strict');
        await nvim.eval('feedkeys("\\<C-n>", "in")');
        await helper_1.default.wait(30);
        let item = await manager_1.default.ui.item;
        expect(item.label).toMatch(locations[1].text);
        await nvim.eval('feedkeys("\\<C-p>", "in")');
        await helper_1.default.wait(30);
        item = await manager_1.default.ui.item;
        expect(item.label).toMatch(locations[0].text);
        await nvim.eval('feedkeys("\\<C-x>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(false);
        await manager_1.default.start(['location']);
        await nvim.eval('feedkeys("\\<C-q>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(false);
        let winnr = await nvim.call('winnr');
        expect(winnr > 1).toBe(true);
        await manager_1.default.start(['location']);
        await nvim.eval('feedkeys("?", "in")');
        await helper_1.default.wait(30);
        await nvim.input('<CR>');
        await manager_1.default.cancel();
        await manager_1.default.start(['location']);
        await nvim.eval('feedkeys("\\<C-d>", "in")');
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(false);
    });
    it('should execute prompt mappings', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-p>': 'prompt:previous',
            '<C-n>': 'prompt:next',
            '<C-a>': 'prompt:start',
            '<C-e>': 'prompt:end',
            '<Left>': 'prompt:left',
            '<Right>': 'prompt:right',
            '<Backspace>': 'prompt:deleteforward',
            '<C-x>': 'prompt:deletebackward',
            '<C-k>': 'prompt:removeTail',
            '<C-u>': 'prompt.removeAhead',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        for (let key of ['<C-p>', '<C-n>', '<C-a>', '<C-e>', '<Left>', '<Right>', '<Backspace>', '<C-x>', '<C-k>', '<C-u>']) {
            await nvim.input(key);
            await helper_1.default.wait(30);
        }
        expect(manager_1.default.isActivated).toBe(true);
    });
    it('should execute action keymap', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-d>': 'action:tabe',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-d>", "in")`);
        await helper_1.default.wait(30);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(2);
    });
    it('should execute feedkeys keymap', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-f>': 'feedkeys:\\<C-f>',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-f>", "in")`);
        await helper_1.default.wait(30);
        let line = await nvim.call('line', '.');
        expect(line).toBe(locations.length);
    });
    it('should execute normal keymap', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-g>': 'normal:G',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-g>", "in")`);
        await helper_1.default.wait(30);
        let line = await nvim.call('line', '.');
        expect(line).toBe(locations.length);
    });
    it('should execute command keymap', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-w>': 'command:wincmd p',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-w>", "in")`);
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(true);
        let winnr = await nvim.call('winnr');
        expect(winnr).toBe(1);
    });
    it('should execute call keymap', async () => {
        await helper_1.default.mockFunction('Test', 1);
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-t>': 'call:Test',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-t>", "in")`);
        await helper_1.default.wait(30);
        expect(manager_1.default.isActivated).toBe(true);
    });
    it('should execute expr keymap', async () => {
        await helper_1.default.mockFunction('TabOpen', 'tabe');
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-t>': 'expr:TabOpen',
        });
        await manager_1.default.start(['location']);
        await helper_1.default.wait(30);
        await nvim.eval(`feedkeys("\\<C-t>", "in")`);
        await helper_1.default.wait(30);
        let nr = await nvim.call('tabpagenr');
        expect(nr).toBe(2);
    });
    it('should insert clipboard to prompt', async () => {
        helper_1.default.updateConfiguration('list.insertMappings', {
            '<C-r>': 'prompt:paste',
        });
        await nvim.command('let @* = "foo"');
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval(`feedkeys("\\<C-r>", "in")`);
        await helper_1.default.wait(200);
        let { input } = manager_1.default.prompt;
        expect(input).toMatch('foo');
    });
});
//# sourceMappingURL=mappings.test.js.map