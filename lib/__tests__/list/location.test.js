"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const manager_1 = tslib_1.__importDefault(require("../../list/manager"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const events_1 = tslib_1.__importDefault(require("../../events"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
let nvim;
const locations = [{
        filename: __filename,
        range: vscode_languageserver_protocol_1.Range.create(0, 0, 0, 6),
        text: 'foo'
    }, {
        filename: __filename,
        range: vscode_languageserver_protocol_1.Range.create(2, 0, 2, 6),
        text: 'Bar'
    }, {
        filename: __filename,
        range: vscode_languageserver_protocol_1.Range.create(3, 0, 4, 6),
        text: 'multiple'
    }];
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
describe('list commands', () => {
    it('should highlight ranges', async () => {
        await manager_1.default.start(['--normal', '--auto-preview', 'location']);
        await helper_1.default.wait(300);
        await nvim.command('wincmd k');
        let name = await nvim.eval('bufname("%")');
        expect(name).toMatch(__filename);
        let matches = await nvim.call('getmatches');
        let find = matches.find(o => o.group == 'Search');
        expect(find).toBeDefined();
    });
    it('should change highlight on cursor move', async () => {
        await manager_1.default.start(['--normal', '--auto-preview', 'location']);
        await helper_1.default.wait(300);
        await nvim.command('exe 2');
        let bufnr = await nvim.eval('bufnr("%")');
        await events_1.default.fire('CursorMoved', [bufnr, [2, 1]]);
        await helper_1.default.wait(300);
        await nvim.command('wincmd k');
        let matches = await nvim.call('getmatches');
        let find = matches.find(o => o.group == 'Search');
        expect(find.pos1).toEqual([3, 1, 6]);
    });
    it('should highlight multiple line range', async () => {
        await manager_1.default.start(['--normal', '--auto-preview', 'location']);
        await helper_1.default.wait(300);
        await nvim.command('exe 3');
        let bufnr = await nvim.eval('bufnr("%")');
        await events_1.default.fire('CursorMoved', [bufnr, [2, 1]]);
        await helper_1.default.wait(300);
        await nvim.command('wincmd k');
        let matches = await nvim.call('getmatches');
        expect(matches.filter(o => o.group == 'Search').length).toBe(2);
    });
});
//# sourceMappingURL=location.test.js.map