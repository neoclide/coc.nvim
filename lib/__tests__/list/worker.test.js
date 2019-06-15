"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const manager_1 = tslib_1.__importDefault(require("../../list/manager"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
const __1 = require("../..");
const events_1 = require("events");
const safe_1 = tslib_1.__importDefault(require("colors/safe"));
class TaskList extends __1.BasicList {
    constructor() {
        super(...arguments);
        this.name = 'task';
        this.timeout = 3000;
    }
    loadItems(_context, token) {
        let emitter = new events_1.EventEmitter();
        let i = 0;
        let interval = setInterval(() => {
            emitter.emit('data', { label: i.toFixed() });
            i++;
        }, 300);
        emitter.dispose = () => {
            clearInterval(interval);
            emitter.emit('end');
        };
        token.onCancellationRequested(() => {
            emitter.dispose();
        });
        return emitter;
    }
}
class InteractiveList extends __1.BasicList {
    constructor() {
        super(...arguments);
        this.name = 'test';
        this.interactive = true;
    }
    loadItems(context, _token) {
        return Promise.resolve([{
                label: safe_1.default.magenta(context.input || '')
            }]);
    }
}
class ErrorList extends __1.BasicList {
    constructor() {
        super(...arguments);
        this.name = 'error';
        this.interactive = true;
    }
    loadItems(_context, _token) {
        return Promise.reject(new Error('test error'));
    }
}
class ErrorTaskList extends __1.BasicList {
    constructor() {
        super(...arguments);
        this.name = 'task';
    }
    loadItems(_context, _token) {
        let emitter = new events_1.EventEmitter();
        let i = 0;
        let timeout = setTimeout(() => {
            emitter.emit('error', new Error('task error'));
            i++;
        }, 100);
        emitter.dispose = () => {
            clearTimeout(timeout);
        };
        return emitter;
    }
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
    await manager_1.default.cancel();
    await helper_1.default.reset();
});
describe('list worker', () => {
    it('should work with task', async () => {
        let disposable = manager_1.default.registerList(new TaskList(nvim));
        await manager_1.default.start(['task']);
        await helper_1.default.wait(1500);
        let len = manager_1.default.ui.length;
        expect(len > 2).toBe(true);
        await manager_1.default.cancel();
        disposable.dispose();
    });
    it('should cancel task by use CancellationToken', async () => {
        let disposable = manager_1.default.registerList(new TaskList(nvim));
        await manager_1.default.start(['task']);
        expect(manager_1.default.worker.isLoading).toBe(true);
        await helper_1.default.wait(500);
        manager_1.default.worker.stop();
        expect(manager_1.default.worker.isLoading).toBe(false);
        disposable.dispose();
    });
    it('should work with interactive list', async () => {
        let disposable = manager_1.default.registerList(new InteractiveList(nvim));
        await manager_1.default.start(['-I', 'test']);
        await manager_1.default.ui.ready;
        expect(manager_1.default.ui.shown).toBe(true);
        await nvim.eval('feedkeys("f", "in")');
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("a", "in")');
        await helper_1.default.wait(100);
        await nvim.eval('feedkeys("x", "in")');
        await helper_1.default.wait(300);
        let item = await manager_1.default.ui.item;
        expect(item.label).toBe('fax');
        disposable.dispose();
    });
    it('should not activate on load error', async () => {
        let disposable = manager_1.default.registerList(new ErrorList(nvim));
        await manager_1.default.start(['test']);
        expect(manager_1.default.isActivated).toBe(false);
        disposable.dispose();
    });
    it('should deactivate on task error', async () => {
        let disposable = manager_1.default.registerList(new ErrorTaskList(nvim));
        await manager_1.default.start(['task']);
        expect(manager_1.default.isActivated).toBe(true);
        await helper_1.default.wait(500);
        expect(manager_1.default.isActivated).toBe(false);
        disposable.dispose();
    });
});
//# sourceMappingURL=worker.test.js.map