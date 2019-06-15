"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const path_1 = tslib_1.__importDefault(require("path"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
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
describe('help tags', () => {
    it('should generate help tags', async () => {
        let root = workspace_1.default.pluginRoot;
        let dir = await nvim.call('fnameescape', path_1.default.join(root, 'doc'));
        let res = await nvim.call('execute', `helptags ${dir}`);
        expect(res.length).toBe(0);
    });
    it('should return jumpable', async () => {
        let jumpable = await helper_1.default.plugin.snippetCheck(false, true);
        expect(jumpable).toBe(false);
    });
    it('should show CocInfo', async () => {
        await helper_1.default.plugin.showInfo();
        await helper_1.default.wait(300);
        let line = await nvim.line;
        expect(line).toMatch('versions');
    });
});
//# sourceMappingURL=plugin.test.js.map