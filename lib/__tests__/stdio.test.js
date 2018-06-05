"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const stdioService_1 = require("../model/stdioService");
const path = require("path");
describe('child model test', () => {
    let ch;
    beforeAll(() => {
        let file = path.resolve(__dirname, '../../bin/jedi_server.py');
        ch = new stdioService_1.default('python', [file, '-v']);
        ch.start();
    });
    afterAll(() => {
        ch.stop();
    });
    test('jedi server works', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let res = yield ch.request(JSON.stringify({
            action: 'complete',
            line: 3,
            col: 'datetime.da'.length,
            filename: 'example.py',
            content: '\nimport datetime\ndatetime.da',
        }));
        let items = JSON.parse(res);
        expect(items.length).toBeGreaterThan(1);
    }));
});
//# sourceMappingURL=stdio.test.js.map