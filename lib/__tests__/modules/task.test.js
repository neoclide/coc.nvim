"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importStar(require("../helper"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
describe('task test', () => {
    test('should start task', async () => {
        let task = workspace_1.default.createTask('sleep');
        let started = await task.start({ cmd: 'sleep', args: ['50'] });
        expect(started).toBe(true);
        task.dispose();
    });
    test('should stop task', async () => {
        let task = workspace_1.default.createTask('sleep');
        await task.start({ cmd: 'sleep', args: ['50'] });
        await helper_1.default.wait(10);
        await task.stop();
        let running = await task.running;
        expect(running).toBe(false);
        task.dispose();
    });
    test('should emit exit event', async () => {
        let fn = jest.fn();
        let task = workspace_1.default.createTask('sleep');
        task.onExit(fn);
        await task.start({ cmd: 'sleep', args: ['50'] });
        await helper_1.default.wait(10);
        await task.stop();
        task.dispose();
        expect(fn).toBeCalled();
    });
    test('should emit stdout event', async () => {
        let file = await helper_1.createTmpFile('echo foo');
        let fn = jest.fn();
        let task = workspace_1.default.createTask('echo');
        let called = false;
        task.onStdout(lines => {
            if (!called)
                expect(lines).toEqual(['foo']);
            called = true;
            fn();
        });
        await task.start({ cmd: '/bin/sh', args: [file] });
        await helper_1.default.wait(50);
        task.dispose();
        expect(fn).toBeCalled();
    });
    test('should emit stderr event', async () => {
        let file = await helper_1.createTmpFile('console.error("error")');
        let fn = jest.fn();
        let task = workspace_1.default.createTask('error');
        task.onStderr(lines => {
            expect(lines).toEqual(['error']);
            fn();
        });
        await task.start({ cmd: 'node', args: [file] });
        await helper_1.default.wait(300);
        task.dispose();
        expect(fn).toBeCalled();
    });
});
//# sourceMappingURL=task.test.js.map