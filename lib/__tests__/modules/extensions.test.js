"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const events_1 = tslib_1.__importDefault(require("../../events"));
const extensions_1 = tslib_1.__importDefault(require("../../extensions"));
const helper_1 = tslib_1.__importDefault(require("../helper"));
const uuidv1 = require("uuid/v1");
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
jest.setTimeout(30000);
describe('extensions', () => {
    it('should load global extensions', async () => {
        let stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('activated');
    });
    it('should load local extensions', async () => {
        let folder = path_1.default.resolve(__dirname, '../extensions/local');
        await nvim.command(`set runtimepath^=${folder}`);
        await helper_1.default.wait(200);
        let stat = extensions_1.default.getExtensionState('local');
        expect(stat).toBe('activated');
    });
    it('should install extension', async () => {
        await extensions_1.default.installExtensions(['coc-json', 'https://github.com/neoclide/coc-tsserver']);
        let root = await nvim.call('coc#util#extension_root', []);
        expect(root).toBeDefined();
    });
    it('should udpate extensions', async () => {
        let disposable = await extensions_1.default.updateExtensions('', true);
        if (disposable)
            disposable.dispose();
    });
    it('should get all extensions', () => {
        let list = extensions_1.default.all;
        expect(list.length).toBeGreaterThan(0);
    });
    it('should get extensions stat', async () => {
        let stats = await extensions_1.default.getExtensionStates();
        expect(stats.length).toBeGreaterThan(0);
    });
    it('should toggle extension', async () => {
        await extensions_1.default.toggleExtension('test');
        let stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('disabled');
        await extensions_1.default.toggleExtension('test');
        stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('activated');
    });
    it('should reload extension', async () => {
        await extensions_1.default.reloadExtension('test');
        let stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('activated');
    });
    it('should unload extension', async () => {
        await extensions_1.default.uninstallExtension(['test']);
        let stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('unknown');
        let folder = path_1.default.resolve(__dirname, '../extensions/test');
        await extensions_1.default.loadExtension(folder);
        await extensions_1.default.loadExtension(folder);
    });
    it('should load extension on install', async () => {
        await extensions_1.default.onExtensionInstall('coc-json');
        let stat = extensions_1.default.getExtensionState('coc-json');
        expect(stat).toBe('activated');
    });
    it('should has extension', () => {
        let res = extensions_1.default.has('test');
        expect(res).toBe(true);
    });
    it('should be activated', async () => {
        let res = extensions_1.default.has('test');
        expect(res).toBe(true);
    });
    it('should activate & deactivate extension', async () => {
        extensions_1.default.deactivate('test');
        let stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('loaded');
        extensions_1.default.activate('test');
        stat = extensions_1.default.getExtensionState('test');
        expect(stat).toBe('activated');
    });
    it('should call extension API', async () => {
        let res = await extensions_1.default.call('test', 'echo', ['5']);
        expect(res).toBe('5');
        let p = await extensions_1.default.call('test', 'asAbsolutePath', ['..']);
        expect(p.endsWith('extensions')).toBe(true);
    });
    it('should get extension API', () => {
        let res = extensions_1.default.getExtensionApi('test');
        expect(typeof res.echo).toBe('function');
    });
    it('should get package name from url', () => {
        let name = extensions_1.default.packageNameFromUrl('https://github.com/neoclide/coc-tsserver');
        expect(name).toBe('coc-tsserver');
    });
});
describe('extensions active events', () => {
    function createExtension(event) {
        let id = uuidv1();
        let isActive = false;
        let packageJSON = {
            name: id,
            activationEvents: [event]
        };
        let ext = {
            id,
            packageJSON,
            exports: void 0,
            extensionPath: '',
            activate: async () => {
                isActive = true;
            }
        };
        Object.defineProperty(ext, 'isActive', {
            get: () => {
                return isActive;
            }
        });
        extensions_1.default.registerExtension(ext, () => {
            isActive = false;
        });
        return ext;
    }
    it('should activate on language', async () => {
        let ext = createExtension('onLanguage:javascript');
        expect(ext.isActive).toBe(false);
        await nvim.command('edit /tmp/a.js');
        await helper_1.default.wait(300);
        expect(ext.isActive).toBe(true);
        ext = createExtension('onLanguage:javascript');
        expect(ext.isActive).toBe(true);
    });
    it('should activate on command', async () => {
        let ext = createExtension('onCommand:test.echo');
        await events_1.default.fire('Command', ['test.echo']);
        await helper_1.default.wait(30);
        expect(ext.isActive).toBe(true);
    });
    it('should activate on workspace contains', async () => {
        let ext = createExtension('workspaceContains:package.json');
        let root = path_1.default.resolve(__dirname, '../../..');
        await nvim.command(`edit ${path_1.default.join(root, 'file.js')}`);
        await helper_1.default.wait(100);
        expect(ext.isActive).toBe(true);
    });
    it('should activate on file system', async () => {
        let ext = createExtension('onFileSystem:zip');
        await nvim.command('edit zip:///a');
        await helper_1.default.wait(30);
        expect(ext.isActive).toBe(true);
        ext = createExtension('onFileSystem:zip');
        expect(ext.isActive).toBe(true);
    });
});
describe('extension properties', () => {
    it('should get extensionPath', () => {
        let ext = extensions_1.default.getExtension('test');
        let p = ext.extension.extensionPath;
        expect(p.endsWith('test')).toBe(true);
    });
    it('should deactivate', () => {
        let ext = extensions_1.default.getExtension('test');
        ext.deactivate();
        expect(ext.extension.isActive).toBe(false);
        extensions_1.default.activate('test');
    });
});
//# sourceMappingURL=extensions.test.js.map