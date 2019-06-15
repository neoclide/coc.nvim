"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net_1 = tslib_1.__importDefault(require("net"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const bser_1 = tslib_1.__importDefault(require("bser"));
const watchman_1 = tslib_1.__importDefault(require("../../watchman"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
const outputChannel_1 = tslib_1.__importDefault(require("../../model/outputChannel"));
let server;
let client;
const sockPath = '/tmp/watchman-fake';
process.env.WATCHMAN_SOCK = sockPath;
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    watchman_1.default.dispose();
    await helper_1.default.shutdown();
});
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}
function sendResponse(data) {
    client.write(bser_1.default.dumpToBuffer(data));
}
function createFileChange(file, exists = true) {
    return {
        size: 1,
        name: file,
        exists,
        type: 'f',
        mtime_ms: Date.now()
    };
}
function sendSubscription(uid, root, files) {
    client.write(bser_1.default.dumpToBuffer({
        subscription: uid,
        root,
        files
    }));
}
beforeAll(done => {
    // create a mock sever for watchman
    server = net_1.default.createServer(c => {
        client = c;
        c.on('data', data => {
            let obj = bser_1.default.loadFromBuffer(data);
            if (obj[0] == 'watch-project') {
                sendResponse({ watch: obj[1] });
            }
            else if (obj[0] == 'unsubscribe') {
                sendResponse({ path: obj[1] });
            }
            else if (obj[0] == 'clock') {
                sendResponse({ clock: 'clock' });
            }
            else if (obj[0] == 'version') {
                let { optional, required } = obj[1];
                let res = {};
                for (let key of Object.keys(optional)) {
                    res[key] = true;
                }
                for (let key of Object.keys(required)) {
                    res[key] = true;
                }
                sendResponse({ capabilities: res });
            }
            else if (obj[0] == 'subscribe') {
                sendResponse({ subscribe: obj[2] });
            }
            else {
                sendResponse({});
            }
        });
    });
    server.on('error', err => {
        throw err;
    });
    server.listen(sockPath, () => {
        done();
    });
});
afterAll(() => {
    client.unref();
    server.close();
    if (fs_1.default.existsSync(sockPath)) {
        fs_1.default.unlinkSync(sockPath);
    }
});
describe('watchman', () => {
    it('should checkCapability', async () => {
        let client = new watchman_1.default(null);
        let res = await client.checkCapability();
        expect(res).toBe(true);
        client.dispose();
    });
    it('should watchProject', async () => {
        let client = new watchman_1.default(null);
        let res = await client.watchProject('/tmp/coc');
        expect(res).toBe(true);
        client.dispose();
    });
    it('should subscribe', async () => {
        let client = new watchman_1.default(null, new outputChannel_1.default('watchman', nvim));
        await client.watchProject('/tmp');
        let fn = jest.fn();
        let disposable = await client.subscribe('/tmp/*', fn);
        let changes = [createFileChange('/tmp/a')];
        sendSubscription(global.subscribe, '/tmp', changes);
        await wait(100);
        expect(fn).toBeCalled();
        let call = fn.mock.calls[0][0];
        disposable.dispose();
        expect(call.root).toBe('/tmp');
        client.dispose();
    });
    it('should unsubscribe', async () => {
        let client = new watchman_1.default(null);
        await client.watchProject('/tmp');
        let fn = jest.fn();
        let disposable = await client.subscribe('/tmp/*', fn);
        disposable.dispose();
        client.dispose();
    });
});
describe('Watchman#createClient', () => {
    it('should create client', async () => {
        let client = await watchman_1.default.createClient(null, '/tmp');
        expect(client).toBeDefined();
        client.dispose();
    });
    it('should resue client for same root', async () => {
        let client = await watchman_1.default.createClient(null, '/tmp');
        expect(client).toBeDefined();
        let other = await watchman_1.default.createClient(null, '/tmp');
        expect(client).toBe(other);
        client.dispose();
    });
    it('should not create client for root', async () => {
        let client = await watchman_1.default.createClient(null, '/');
        expect(client).toBeNull();
    });
});
//# sourceMappingURL=watchman.test.js.map