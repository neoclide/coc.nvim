"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const manager_1 = tslib_1.__importDefault(require("../../snippets/manager"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
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
describe('snippet provider', () => {
    it('should not active insert plain snippet', async () => {
        let doc = await helper_1.default.createDocument();
        await manager_1.default.insertSnippet('foo');
        let line = await nvim.line;
        expect(line).toBe('foo');
        expect(manager_1.default.session).toBe(null);
        expect(manager_1.default.getSession(doc.bufnr)).toBeUndefined();
    });
    it('should goto next placeholder', async () => {
        await helper_1.default.createDocument();
        await manager_1.default.insertSnippet('${1:a} ${2:b}');
        await manager_1.default.nextPlaceholder();
        await helper_1.default.wait(30);
        let col = await nvim.call('col', '.');
        expect(col).toBe(3);
    });
    it('should goto previous placeholder', async () => {
        await helper_1.default.createDocument();
        await manager_1.default.insertSnippet('${1:a} ${2:b}');
        await manager_1.default.nextPlaceholder();
        await manager_1.default.previousPlaceholder();
        let col = await nvim.call('col', '.');
        expect(col).toBe(1);
    });
    it('should remove keymap on nextPlaceholder when session not exits', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.call('coc#snippet#enable');
        await manager_1.default.nextPlaceholder();
        await helper_1.default.wait(60);
        let val = await doc.buffer.getVar('coc_snippet_active');
        expect(val).toBe(0);
    });
    it('should remove keymap on previousPlaceholder when session not exits', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.call('coc#snippet#enable');
        await manager_1.default.previousPlaceholder();
        await helper_1.default.wait(60);
        let val = await doc.buffer.getVar('coc_snippet_active');
        expect(val).toBe(0);
    });
    it('should update placeholder on placeholder update', async () => {
        await helper_1.default.createDocument();
        await nvim.setLine('bar');
        await manager_1.default.insertSnippet('${1:foo} $1 ');
        let line = await nvim.line;
        expect(line).toBe('foo foo bar');
        await helper_1.default.wait(60);
        await nvim.input('update');
        await helper_1.default.wait(200);
        line = await nvim.line;
        expect(line).toBe('update update bar');
    });
    it('should adjust cursor position on update', async () => {
        await helper_1.default.createDocument();
        await nvim.command('startinsert');
        await manager_1.default.insertSnippet('${1/..*/ -> /}$1');
        let line = await nvim.line;
        expect(line).toBe('');
        await helper_1.default.wait(60);
        await nvim.input('x');
        await helper_1.default.wait(400);
        line = await nvim.line;
        expect(line).toBe(' -> x');
        let col = await nvim.call('col', '.');
        expect(col).toBe(6);
    });
    it('should check position on InsertEnter', async () => {
        await helper_1.default.createDocument();
        await nvim.input('ibar<left><left><left>');
        await manager_1.default.insertSnippet('${1:foo} $1 ');
        await helper_1.default.wait(60);
        await nvim.input('<esc>A');
        await helper_1.default.wait(60);
        expect(manager_1.default.session).toBeNull();
    });
    it('should cancel snippet session', async () => {
        let { buffer } = await helper_1.default.createDocument();
        await nvim.call('coc#snippet#enable');
        manager_1.default.cancel();
        await helper_1.default.wait(60);
        let val = await buffer.getVar('coc_snippet_active');
        expect(val).toBe(0);
        let active = await manager_1.default.insertSnippet('${1:foo}');
        expect(active).toBe(true);
        manager_1.default.cancel();
        expect(manager_1.default.session).toBeNull();
    });
    it('should dispose', async () => {
        await helper_1.default.createDocument();
        let active = await manager_1.default.insertSnippet('${1:foo}');
        expect(active).toBe(true);
        manager_1.default.dispose();
        expect(manager_1.default.session).toBe(null);
    });
    it('should start new session if session exists', async () => {
        await helper_1.default.createDocument();
        await nvim.setLine('bar');
        await manager_1.default.insertSnippet('${1:foo} ');
        await helper_1.default.wait(100);
        await nvim.input('<esc>');
        await nvim.command('stopinsert');
        await nvim.input('A');
        await helper_1.default.wait(100);
        let active = await manager_1.default.insertSnippet('${2:bar}');
        expect(active).toBe(true);
        let line = await nvim.getLine();
        expect(line).toBe('foo barbar');
    });
    it('should start nest session', async () => {
        await helper_1.default.createDocument();
        await manager_1.default.insertSnippet('${1:foo} ${2:bar}');
        await nvim.input('<backspace>');
        await helper_1.default.wait(100);
        let active = await manager_1.default.insertSnippet('${1:x} $1');
        expect(active).toBe(true);
    });
    it('should work with nest snippet', async () => {
        let buf = await helper_1.default.edit();
        let snip = '<a ${1:http://www.${2:example.com}}>\n$0\n</a>';
        await manager_1.default.insertSnippet(snip);
        await helper_1.default.wait(30);
        await nvim.input('abcde');
        await helper_1.default.wait(100);
        let lines = await buf.lines;
        expect(lines).toEqual(['<a abcde>', '', '</a>']);
    });
    it('should respect preferCompleteThanJumpPlaceholder', async () => {
        let config = workspace_1.default.getConfiguration('suggest');
        config.update('preferCompleteThanJumpPlaceholder', true);
        await helper_1.default.createDocument();
        await nvim.setLine('foo');
        await nvim.input('o');
        await manager_1.default.insertSnippet('${1:foo} ${2:bar}');
        await helper_1.default.wait(10);
        await nvim.input('f');
        await helper_1.default.wait(30);
        let pumvisible = await nvim.call('pumvisible');
        expect(pumvisible).toBeTruthy();
        await nvim.input('<C-j>');
        await helper_1.default.wait(200);
        let line = await nvim.getLine();
        expect(line).toBe('foo bar');
    });
    it('should check jumpable', async () => {
        await helper_1.default.createDocument();
        await nvim.input('i');
        await manager_1.default.insertSnippet('${1:foo} ${2:bar}');
        let jumpable = manager_1.default.jumpable();
        expect(jumpable).toBe(true);
        await manager_1.default.nextPlaceholder();
        await helper_1.default.wait(30);
        await manager_1.default.nextPlaceholder();
        await helper_1.default.wait(30);
        jumpable = manager_1.default.jumpable();
        expect(jumpable).toBe(false);
    });
    it('should check plain text snippet', async () => {
        expect(manager_1.default.isPlainText('import ${0}')).toBe(true);
        expect(manager_1.default.isPlainText('import ${0:Data}')).toBe(false);
    });
});
//# sourceMappingURL=manager.test.js.map