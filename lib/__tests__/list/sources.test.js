"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const __1 = require("../..");
const manager_1 = tslib_1.__importDefault(require("../../list/manager"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
let listItems = [];
class OptionList extends __1.BasicList {
    constructor(nvim) {
        super(nvim);
        this.name = 'option';
        this.options = [{
                name: '-w, -word',
                description: 'word'
            }, {
                name: '-i, -input INPUT',
                hasValue: true,
                description: 'input'
            }];
        this.addLocationActions();
    }
    loadItems(_context, _token) {
        return Promise.resolve(listItems);
    }
}
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await manager_1.default.cancel();
    await helper_1.default.reset();
});
describe('BasicList', () => {
    describe('parse arguments', () => {
        it('should parse args #1', () => {
            let list = new OptionList(nvim);
            let res = list.parseArguments(['-w']);
            expect(res).toEqual({ word: true });
        });
        it('should parse args #2', () => {
            let list = new OptionList(nvim);
            let res = list.parseArguments(['-word']);
            expect(res).toEqual({ word: true });
        });
        it('should parse args #3', () => {
            let list = new OptionList(nvim);
            let res = list.parseArguments(['-input', 'foo']);
            expect(res).toEqual({ input: 'foo' });
        });
    });
    describe('preview()', () => {
        it('should preview sketch buffer', async () => {
            await nvim.command('new');
            await nvim.setLine('foo');
            let buffer = await nvim.buffer;
            await helper_1.default.wait(30);
            let doc = workspace_1.default.getDocument(buffer.id);
            expect(doc.uri).toMatch('untitled');
            let list = new OptionList(nvim);
            listItems.push({
                label: 'foo',
                location: vscode_languageserver_types_1.Location.create(doc.uri, vscode_languageserver_types_1.Range.create(0, 0, 0, 0))
            });
            let disposable = manager_1.default.registerList(list);
            await manager_1.default.start(['option']);
            await helper_1.default.wait(100);
            await manager_1.default.doAction('preview');
            await helper_1.default.wait(100);
            await nvim.command('wincmd p');
            let win = await nvim.window;
            let isPreview = await win.getOption('previewwindow');
            expect(isPreview).toBe(true);
            let line = await nvim.line;
            expect(line).toBe('foo');
            disposable.dispose();
        });
    });
});
describe('list sources', () => {
    describe('commands', () => {
        it('should load commands source', async () => {
            await manager_1.default.start(['commands']);
            expect(manager_1.default.isActivated).toBe(true);
        });
        it('should do run action', async () => {
            await manager_1.default.start(['commands']);
            await helper_1.default.wait(100);
            await manager_1.default.doAction();
        });
    });
    describe('diagnostics', () => {
        it('should load diagnostics source', async () => {
            await manager_1.default.start(['diagnostics']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('extensions', () => {
        it('should load extensions source', async () => {
            await manager_1.default.start(['extensions']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('folders', () => {
        it('should load folders source', async () => {
            await manager_1.default.start(['folders']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
        it('should run delete action', async () => {
            await manager_1.default.start(['folders']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            await manager_1.default.doAction('delete');
        });
    });
    describe('links', () => {
        it('should load links source', async () => {
            await manager_1.default.start(['links']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('lists', () => {
        it('should load lists source', async () => {
            await manager_1.default.start(['lists']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('outline', () => {
        it('should load outline source', async () => {
            await manager_1.default.start(['outline']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('output', () => {
        it('should load output source', async () => {
            await manager_1.default.start(['output']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('services', () => {
        it('should load services source', async () => {
            await manager_1.default.start(['services']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('sources', () => {
        it('should load sources source', async () => {
            await manager_1.default.start(['sources']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
    describe('symbols', () => {
        it('should load symbols source', async () => {
            await manager_1.default.start(['symbols']);
            await manager_1.default.ui.ready;
            await helper_1.default.wait(100);
            expect(manager_1.default.isActivated).toBe(true);
        });
    });
});
//# sourceMappingURL=sources.test.js.map