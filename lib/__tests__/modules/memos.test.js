"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const memos_1 = tslib_1.__importDefault(require("../../model/memos"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const fs_1 = tslib_1.__importDefault(require("fs"));
let filepath = path_1.default.join(os_1.default.tmpdir(), 'test');
let memos;
beforeEach(() => {
    memos = new memos_1.default(filepath);
});
afterEach(() => {
    if (fs_1.default.existsSync(filepath)) {
        fs_1.default.unlinkSync(filepath);
    }
});
describe('Memos', () => {
    it('should udpate and get', async () => {
        let memo = memos.createMemento('x');
        await memo.update('foo.bar', 'memo');
        let res = memo.get('foo.bar');
        expect(res).toBe('memo');
    });
    it('should get value for key not exists', async () => {
        let memo = memos.createMemento('y');
        let res = memo.get('xyz');
        expect(res).toBeUndefined();
    });
    it('should use defaultValue when not exists', async () => {
        let memo = memos.createMemento('y');
        let res = memo.get('f.o.o', 'default');
        expect(res).toBe('default');
    });
    it('should update multiple values', async () => {
        let memo = memos.createMemento('x');
        await memo.update('foo', 'x');
        await memo.update('bar', 'y');
        expect(memo.get('foo')).toBe('x');
        expect(memo.get('bar')).toBe('y');
    });
});
//# sourceMappingURL=memos.test.js.map