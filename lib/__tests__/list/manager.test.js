"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const manager_1 = tslib_1.__importDefault(require("../../list/manager"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
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
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
    global.locations = locations;
});
afterEach(async () => {
    await manager_1.default.cancel();
    await helper_1.default.reset();
});
afterAll(async () => {
    await helper_1.default.wait(300);
    await helper_1.default.shutdown();
});
describe('list commands', () => {
    it('should be activated', async () => {
        await manager_1.default.start(['location']);
        expect(manager_1.default.isActivated).toBe(true);
        expect(manager_1.default.name).toBe('location');
        await helper_1.default.wait(500);
        let line = await nvim.getLine();
        expect(line).toMatch(/manager.test.ts/);
    });
    it('should get list names', () => {
        let names = manager_1.default.names;
        expect(names.length > 0).toBe(true);
    });
    it('should resume list', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(300);
        await nvim.eval('feedkeys("j", "in")');
        await helper_1.default.wait(30);
        let line = await nvim.call('line', '.');
        expect(line).toBe(2);
        await manager_1.default.cancel();
        await helper_1.default.wait(30);
        await manager_1.default.resume();
        await helper_1.default.wait(60);
        line = await nvim.call('line', '.');
        expect(line).toBe(2);
    });
    it('should goto next & previous', async () => {
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await manager_1.default.doAction();
        await manager_1.default.cancel();
        let bufname = await nvim.eval('expand("%:p")');
        expect(bufname).toMatch('manager.test.ts');
        await manager_1.default.next();
        let line = await nvim.call('line', '.');
        expect(line).toBe(2);
        await helper_1.default.wait(60);
        await manager_1.default.previous();
        line = await nvim.call('line', '.');
        expect(line).toBe(1);
    });
    it('should parse arguments', async () => {
        await manager_1.default.start(['--input=test', '--normal', '--no-sort', '--ignore-case', '--top', '--number-select', '--auto-preview', '--strict', 'location']);
        await helper_1.default.wait(30);
        let opts = manager_1.default.listOptions;
        expect(opts).toEqual({
            numberSelect: true,
            autoPreview: true,
            input: 'test',
            interactive: false,
            matcher: 'strict',
            ignorecase: true,
            position: 'top',
            mode: 'normal',
            sort: false
        });
    });
});
describe('list options', () => {
    it('should respect input option', async () => {
        await manager_1.default.start(['--input=a', 'location']);
        let line = await helper_1.default.getCmdline();
        expect(line).toMatch('a');
        expect(manager_1.default.isActivated).toBe(true);
    });
    it('should respect regex filter', async () => {
        await manager_1.default.start(['--input=f.o', '--regex', 'location']);
        await helper_1.default.wait(200);
        let item = await manager_1.default.ui.item;
        expect(item.label).toMatch('foo');
    });
    it('should respect normal option', async () => {
        await manager_1.default.start(['--normal', 'location']);
        expect(manager_1.default.isActivated).toBe(true);
        await helper_1.default.wait(200);
        let line = await helper_1.default.getCmdline();
        expect(line).toBe('');
    });
    it('should respect nosort option', async () => {
        await manager_1.default.start(['--ignore-case', '--no-sort', 'location']);
        await helper_1.default.wait(200);
        expect(manager_1.default.isActivated).toBe(true);
        await nvim.input('oo');
        await helper_1.default.wait(500);
    });
    it('should respect ignorecase option', async () => {
        await manager_1.default.start(['--ignore-case', '--strict', 'location']);
        await helper_1.default.wait(200);
        expect(manager_1.default.isActivated).toBe(true);
        await nvim.input('bar');
        await helper_1.default.wait(500);
        let n = manager_1.default.ui.length;
        expect(n).toBe(1);
        let line = await nvim.line;
        expect(line).toMatch('Bar');
    });
    it('should respect top option', async () => {
        await manager_1.default.start(['--top', 'location']);
        expect(manager_1.default.isActivated).toBe(true);
        await helper_1.default.wait(300);
        let nr = await nvim.call('winnr');
        expect(nr).toBe(1);
    });
    it('should respect number select option', async () => {
        await manager_1.default.start(['--number-select', 'location']);
        expect(manager_1.default.isActivated).toBe(true);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("2", "in")');
        await helper_1.default.wait(100);
        let lnum = locations[1].lnum;
        let curr = await nvim.call('line', '.');
        expect(lnum).toBe(curr);
    });
    it('should respect auto preview option', async () => {
        await manager_1.default.start(['--auto-preview', 'location']);
        expect(manager_1.default.isActivated).toBe(true);
        await helper_1.default.wait(300);
        let previewWinnr = await nvim.call('coc#util#has_preview');
        expect(previewWinnr).toBe(2);
        let bufnr = await nvim.call('winbufnr', previewWinnr);
        let buf = nvim.createBuffer(bufnr);
        let name = await buf.name;
        expect(name).toMatch('manager.test.ts');
        await nvim.eval('feedkeys("j", "in")');
        await helper_1.default.wait(100);
        let winnr = await nvim.call('coc#util#has_preview');
        expect(winnr).toBe(previewWinnr);
    });
});
describe('list configuration', () => {
    it('should change indicator', async () => {
        helper_1.default.updateConfiguration('list.indicator', '>>');
        await manager_1.default.start(['location']);
        await helper_1.default.wait(300);
        let line = await helper_1.default.getCmdline();
        expect(line).toMatch('>>');
    });
    it('should change max height limit', async () => {
        helper_1.default.updateConfiguration('list.maxHeight', 2);
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        let win = await nvim.window;
        let height = await win.height;
        expect(height).toBe(2);
        helper_1.default.updateConfiguration('list.maxHeight', 12);
    });
    it('should split right for preview window', async () => {
        helper_1.default.updateConfiguration('list.previewSplitRight', true);
        let win = await nvim.window;
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await manager_1.default.doAction('preview');
        await helper_1.default.wait(100);
        manager_1.default.prompt.cancel();
        await helper_1.default.wait(10);
        await nvim.call('win_gotoid', [win.id]);
        await nvim.command('wincmd l');
        let curr = await nvim.window;
        let isPreview = await curr.getOption('previewwindow');
        expect(isPreview).toBe(true);
        helper_1.default.updateConfiguration('list.previewSplitRight', false);
    });
    it('should change autoResize', async () => {
        helper_1.default.updateConfiguration('list.autoResize', false);
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("b", "in")');
        await helper_1.default.wait(100);
        let win = await nvim.window;
        let height = await win.height;
        expect(height).toBe(3);
    });
    it('should toggle selection mode', async () => {
        await manager_1.default.start(['--normal', 'location']);
        await manager_1.default.ui.ready;
        await nvim.input('V');
        await helper_1.default.wait(30);
        await nvim.input('1');
        await helper_1.default.wait(30);
        await nvim.input('j');
        await helper_1.default.wait(100);
        await manager_1.default.ui.toggleSelection();
        let items = await manager_1.default.ui.getItems();
        expect(items.length).toBe(2);
    });
    it('should change next/previous keymap', async () => {
        helper_1.default.updateConfiguration('list.nextKeymap', '<tab>');
        helper_1.default.updateConfiguration('list.previousKeymap', '<s-tab>');
        await manager_1.default.start(['location']);
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("\\<tab>", "in")');
        await helper_1.default.wait(100);
        let line = await nvim.line;
        expect(line).toMatch('Bar');
        await nvim.eval('feedkeys("\\<s-tab>", "in")');
        await helper_1.default.wait(100);
        line = await nvim.line;
        expect(line).toMatch('foo');
    });
    it('should respect mouse events', async () => {
        async function setMouseEvent(line) {
            let window = manager_1.default.ui.window;
            await nvim.command(`let v:mouse_winid = ${window.id}`);
            await nvim.command(`let v:mouse_lnum = ${line}`);
            await nvim.command(`let v:mouse_col = 1`);
        }
        await manager_1.default.start(['--normal', 'location']);
        await helper_1.default.wait(100);
        await setMouseEvent(1);
        await manager_1.default.onMouseEvent('<LeftMouse>');
        await setMouseEvent(2);
        await manager_1.default.onMouseEvent('<LeftDrag>');
        await setMouseEvent(3);
        await manager_1.default.onMouseEvent('<LeftRelease>');
        await helper_1.default.wait(30);
        let items = await manager_1.default.ui.getItems();
        expect(items.length).toBe(3);
    });
    it('should toggle preview', async () => {
        await manager_1.default.start(['--normal', '--auto-preview', 'location']);
        await helper_1.default.wait(200);
        await manager_1.default.togglePreview();
        await helper_1.default.wait(100);
        await manager_1.default.togglePreview();
        await helper_1.default.wait(100);
        let has = await nvim.call('coc#list#has_preview');
        expect(has).toBe(1);
    });
    it('should resolve list item', async () => {
        let list = {
            name: 'test',
            actions: [{
                    name: 'open', execute: _item => {
                        // noop
                    }
                }],
            defaultAction: 'open',
            loadItems: () => {
                return Promise.resolve([{ label: 'foo' }, { label: 'bar' }]);
            },
            resolveItem: item => {
                item.label = item.label.slice(0, 1);
                return Promise.resolve(item);
            }
        };
        let disposable = manager_1.default.registerList(list);
        await manager_1.default.start(['--normal', 'test']);
        await helper_1.default.wait(500);
        let line = await nvim.line;
        expect(line).toBe('f');
        disposable.dispose();
    });
});
//# sourceMappingURL=manager.test.js.map