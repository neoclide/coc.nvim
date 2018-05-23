"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const ipcService_1 = require("../model/ipcService");
const constant_1 = require("../constant");
const path = require("path");
describe('child model test', () => {
    let ch;
    beforeAll(() => {
        const file = path.resolve(__dirname, '../../bin/tern.js');
        const ternRoot = path.join(constant_1.ROOT, 'node_modules/tern');
        ch = new ipcService_1.default(file, process.cwd(), [], [ternRoot]);
        ch.start();
    });
    afterAll(() => {
        ch.stop();
    });
    test('tern server works', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let result = '';
        let res = yield ch.request({
            action: 'complete',
            line: 2,
            col: 'arr.p'.length,
            filename: 'example.js',
            content: '\nlet arr = [];\narr.p',
        });
        expect(res.length).toBeGreaterThan(1);
    }));
});
//# sourceMappingURL=ipc.test.js.map