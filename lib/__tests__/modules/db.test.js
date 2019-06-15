"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const db_1 = tslib_1.__importDefault(require("../../model/db"));
const path_1 = tslib_1.__importDefault(require("path"));
let db;
beforeAll(async () => {
    db = new db_1.default(path_1.default.join(__dirname, 'db.json'));
});
afterAll(async () => {
    await db.destroy();
});
afterEach(async () => {
    await db.clear();
});
describe('DB', () => {
    test('db.exists()', async () => {
        let exists = await db.exists('a.b');
        expect(exists).toBe(false);
        await db.push('a.b', { foo: 1 });
        exists = await db.exists('a.b.foo');
        expect(exists).toBe(true);
    });
    test('db.fetch()', async () => {
        let res = await db.fetch('x');
        expect(res).toBeUndefined();
        await db.push('x', 1);
        res = await db.fetch('x');
        expect(res).toBe(1);
        await db.push('x', { foo: 1 });
        res = await db.fetch('x');
        expect(res).toEqual({ foo: 1 });
    });
    test('db.delete()', async () => {
        await db.push('foo.bar', 1);
        await db.delete('foo.bar');
        let exists = await db.exists('foo.bar');
        expect(exists).toBe(false);
    });
    test('db.push()', async () => {
        await db.push('foo.x', 1);
        await db.push('foo.y', '2');
        await db.push('foo.z', true);
        await db.push('foo.n', null);
        await db.push('foo.o', { x: 1 });
        let res = await db.fetch('foo');
        expect(res).toEqual({
            x: 1,
            y: '2',
            z: true,
            n: null,
            o: { x: 1 }
        });
    });
});
//# sourceMappingURL=db.test.js.map