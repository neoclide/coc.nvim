"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const types_1 = require("../../types");
const sources_1 = tslib_1.__importDefault(require("../../sources"));
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
describe('native sources', () => {
    it('should works for around source', async () => {
        await helper_1.default.createDocument();
        await nvim.setLine('foo ');
        await helper_1.default.wait(100);
        let { mode } = await nvim.mode;
        expect(mode).toBe('n');
        await nvim.input('Af');
        let res = await helper_1.default.visible('foo', 'around');
        expect(res).toBe(true);
        await nvim.input('<esc>');
    });
    it('should works for buffer source', async () => {
        await nvim.command('set hidden');
        await helper_1.default.createDocument();
        await helper_1.default.createDocument();
        await nvim.setLine('other');
        await nvim.command('bp');
        await helper_1.default.wait(300);
        let { mode } = await nvim.mode;
        expect(mode).toBe('n');
        await nvim.input('io');
        let res = await helper_1.default.visible('other', 'buffer');
        expect(res).toBe(true);
    });
    it('should works for file source', async () => {
        await helper_1.default.edit();
        await nvim.input('i/');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBeGreaterThan(0);
        let res = await helper_1.default.visible(items[0].word, 'file');
        expect(res).toBe(true);
        await nvim.input('<esc>');
        await nvim.input('o./');
        await helper_1.default.waitPopup();
        items = await helper_1.default.getItems();
        let item = items.find(o => o.word == 'vimrc');
        expect(item).toBeTruthy();
    });
    it('should works for file source with other source use same triggerCharacter', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'test',
            priority: 50,
            enable: true,
            firstMatch: false,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.', '/'],
            doComplete: async () => {
                let result = {
                    items: [{ word: 'foo' }]
                };
                return Promise.resolve(result);
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBe(1);
        await nvim.input('/');
        await helper_1.default.waitPopup();
        items = await helper_1.default.getItems();
        expect(items.length).toBeGreaterThan(1);
        expect(items[0].word).toBe('foo');
        disposable.dispose();
    });
});
//# sourceMappingURL=sources.test.js.map