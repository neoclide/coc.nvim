"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const terminal_1 = tslib_1.__importDefault(require("../../model/terminal"));
let nvim;
let terminal;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
    terminal = new terminal_1.default('sh', [], nvim);
    await terminal.start();
});
afterAll(async () => {
    terminal.dispose();
    await helper_1.default.shutdown();
});
describe('terminal properties', () => {
    it('should get name', () => {
        let name = terminal.name;
        expect(name).toBe('sh');
    });
    it('should get pid', async () => {
        let pid = await terminal.processId;
        expect(typeof pid).toBe('number');
    });
    it('should hide terminal window', async () => {
        await terminal.hide();
        let winnr = await nvim.call('bufwinnr', terminal.bufnr);
        expect(winnr).toBe(-1);
    });
    it('should show terminal window', async () => {
        await terminal.show();
        let winnr = await nvim.call('bufwinnr', terminal.bufnr);
        expect(winnr != -1).toBe(true);
    });
    it('should send text', async () => {
        terminal.sendText('ls');
        await helper_1.default.wait(100);
        let buf = nvim.createBuffer(terminal.bufnr);
        let lines = await buf.lines;
        expect(lines.join('\n')).toMatch('vimrc');
    });
});
//# sourceMappingURL=terminal.test.js.map