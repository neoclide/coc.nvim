"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = tslib_1.__importDefault(require("../../events"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}
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
describe('attach', () => {
    it('should listen CocInstalled', async () => {
        nvim.emit('notification', 'VimEnter');
        await helper_1.default.wait(100);
    });
    it('should not throw on event handler error', async () => {
        events_1.default.on('CursorHold', async () => {
            throw new Error('error');
        });
        let fn = jest.fn();
        nvim.emit('request', 'CocAutocmd', ['CursorHold'], {
            send: fn
        });
        await wait(100);
        expect(fn).toBeCalled();
    });
    it('should not throw when plugin method not found', async () => {
        let fn = jest.fn();
        nvim.emit('request', 'NotExists', [], {
            send: fn
        });
        await wait(100);
        expect(fn).toBeCalled();
    });
});
//# sourceMappingURL=attach.test.js.map