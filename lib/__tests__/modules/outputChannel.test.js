"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const outputChannel_1 = tslib_1.__importDefault(require("../../model/outputChannel"));
const util_1 = require("../../util");
const helper_1 = tslib_1.__importDefault(require("../helper"));
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterEach(async () => {
    await helper_1.default.reset();
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
describe('OutputChannel', () => {
    test('outputChannel.show(true)', async () => {
        let c = new outputChannel_1.default('0', nvim);
        let bufnr = (await nvim.buffer).id;
        c.show(true);
        await util_1.wait(100);
        let nr = (await nvim.buffer).id;
        expect(bufnr).toBe(nr);
    });
    test('outputChannel.show(false)', async () => {
        let c = new outputChannel_1.default('1', nvim);
        let bufnr = (await nvim.buffer).id;
        c.show();
        await util_1.wait(100);
        let nr = (await nvim.buffer).id;
        expect(bufnr).toBeLessThan(nr);
    });
    test('outputChannel.appendLine()', async () => {
        let c = new outputChannel_1.default('2', nvim);
        c.show();
        await util_1.wait(100);
        let buf = await nvim.buffer;
        c.appendLine('foo');
        await util_1.wait(100);
        let lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false });
        expect(lines).toContain('foo');
    });
    test('outputChannel.append()', async () => {
        let c = new outputChannel_1.default('3', nvim);
        c.show(false);
        await util_1.wait(60);
        let buf = await nvim.buffer;
        c.append('foo');
        c.append('bar');
        await util_1.wait(200);
        let lines = await buf.lines;
        expect(lines.join('\n')).toMatch('foo');
    });
    test('outputChannel.clear()', async () => {
        let c = new outputChannel_1.default('4', nvim);
        c.show(false);
        await util_1.wait(30);
        let buf = await nvim.buffer;
        c.appendLine('foo');
        c.appendLine('bar');
        await util_1.wait(30);
        c.clear();
        await util_1.wait(30);
        let lines = await buf.lines;
        let content = lines.join('');
        expect(content).toBe('');
    });
});
//# sourceMappingURL=outputChannel.test.js.map