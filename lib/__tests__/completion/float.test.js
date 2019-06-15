"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const sources_1 = tslib_1.__importDefault(require("../../sources"));
const types_1 = require("../../types");
const helper_1 = tslib_1.__importDefault(require("../helper"));
let nvim;
let source;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
    source = {
        name: 'float',
        priority: 10,
        enable: true,
        sourceType: types_1.SourceType.Native,
        doComplete: () => {
            return Promise.resolve({
                items: [{
                        word: 'foo',
                        info: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
                    }, {
                        word: 'foot',
                        info: 'foot'
                    }, {
                        word: 'football',
                    }]
            });
        }
    };
    sources_1.default.addSource(source);
});
afterAll(async () => {
    sources_1.default.removeSource(source);
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
describe('completion float', () => {
    it('should not show float window when disabled', async () => {
        helper_1.default.updateConfiguration('suggest.floatEnable', false);
        await helper_1.default.edit();
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.wait(30);
        await helper_1.default.pumvisible();
        helper_1.default.updateConfiguration('suggest.floatEnable', true);
        let hasFloat = await nvim.call('coc#util#has_float');
        expect(hasFloat).toBe(0);
    });
    it('should cancel float window', async () => {
        await helper_1.default.edit();
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.wait(30);
        await helper_1.default.pumvisible();
        let items = await helper_1.default.getItems();
        expect(items[0].word).toBe('foo');
        expect(items[0].info.length > 0).toBeTruthy();
        await nvim.input('<C-n>');
        await helper_1.default.wait(500);
        await nvim.input('<esc>');
        await helper_1.default.wait(100);
        let hasFloat = await nvim.call('coc#util#has_float');
        expect(hasFloat).toBe(0);
    });
    it('should adjust float window position', async () => {
        await helper_1.default.edit();
        await nvim.setLine(' '.repeat(70));
        await nvim.input('A');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.visible('foo', 'float');
        await nvim.input('<C-n>');
        await helper_1.default.wait(300);
        let floatWin = await helper_1.default.getFloat();
        let config = await floatWin.getConfig();
        expect(config.col + config.width).toBeLessThan(80);
    });
    it('should redraw float window on item change', async () => {
        await helper_1.default.edit();
        await nvim.setLine(' '.repeat(70));
        await nvim.input('A');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.visible('foo', 'float');
        await nvim.input('<C-n>');
        await helper_1.default.wait(10);
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        let floatWin = await helper_1.default.getFloat();
        let buf = await floatWin.buffer;
        let lines = await buf.lines;
        expect(lines.length).toBeGreaterThan(0);
        expect(lines[0]).toMatch('foot');
    });
    it('should hide float window when item info is empty', async () => {
        await helper_1.default.edit();
        await nvim.setLine(' '.repeat(70));
        await nvim.input('A');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.visible('foo', 'float');
        await nvim.input('<C-n>');
        await helper_1.default.wait(10);
        await nvim.input('<C-n>');
        await helper_1.default.wait(10);
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        let hasFloat = await nvim.call('coc#util#has_float');
        expect(hasFloat).toBe(0);
    });
    it('should hide float window after completion', async () => {
        await helper_1.default.edit();
        await nvim.setLine(' '.repeat(70));
        await nvim.input('A');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.visible('foo', 'float');
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        await nvim.input('<C-y>');
        await helper_1.default.wait(30);
        let hasFloat = await nvim.call('coc#util#has_float');
        expect(hasFloat).toBe(0);
    });
});
//# sourceMappingURL=float.test.js.map