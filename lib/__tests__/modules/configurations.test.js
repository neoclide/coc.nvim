"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const configuration_1 = tslib_1.__importDefault(require("../../configuration"));
const util_1 = require("../../configuration/util");
const vscode_uri_1 = require("vscode-uri");
const uuidv1 = require("uuid/v1");
const config = fs_1.default.readFileSync(path_1.default.join(__dirname, './settings.json'), 'utf8');
const workspaceConfigFile = path_1.default.resolve(__dirname, '../sample/.vim/coc-settings.json');
function getConfigurationModel() {
    let [, contents] = util_1.parseConfiguration(config);
    return { contents };
}
function createConfigurations() {
    let userConfigFile = path_1.default.join(__dirname, './settings.json');
    return new configuration_1.default(userConfigFile);
}
describe('Configurations', () => {
    it('should convert errors', () => {
        let errors = [];
        for (let i = 0; i < 17; i++) {
            errors.push({
                error: i,
                offset: 0,
                length: 10
            });
        }
        let res = util_1.convertErrors('file:///1', 'abc', errors);
        expect(res.length).toBe(17);
    });
    it('should get all keys', () => {
        let res = util_1.getKeys({
            foo: {
                bar: 1,
                from: {
                    to: 2
                }
            },
            bar: [1, 2]
        });
        expect(res).toEqual(['foo', 'foo.bar', 'foo.from', 'foo.from.to', 'bar']);
    });
    it('should get configuration value', () => {
        let root = {
            foo: {
                bar: 1,
                from: {
                    to: 2
                }
            },
            bar: [1, 2]
        };
        let res = util_1.getConfigurationValue(root, 'foo.from.to', 1);
        expect(res).toBe(2);
        res = util_1.getConfigurationValue(root, 'foo.from', 1);
        expect(res).toEqual({ to: 2 });
    });
    it('should add folder as workspace configuration', () => {
        let configurations = createConfigurations();
        configurations.onDidChange(e => {
            let affects = e.affectsConfiguration('coc');
            expect(affects).toBe(true);
        });
        configurations.addFolderFile(workspaceConfigFile);
        let o = configurations.configuration.workspace.contents;
        expect(o.coc.preferences.rootPath).toBe('./src');
        configurations.dispose();
    });
    it('should get changed keys #1', () => {
        let res = util_1.getChangedKeys({ y: 2 }, { x: 1 });
        expect(res).toEqual(['x', 'y']);
    });
    it('should get changed keys #2', () => {
        let res = util_1.getChangedKeys({ x: 1, c: { d: 4 } }, { x: 1, b: { x: 5 } });
        expect(res).toEqual(['b', 'b.x', 'c', 'c.d']);
    });
    it('should load default configurations', () => {
        let conf = new configuration_1.default();
        expect(conf.defaults.contents.coc).toBeDefined();
        let c = conf.getConfiguration('languageserver');
        expect(c).toEqual({});
        conf.dispose();
    });
    it('should parse configurations', () => {
        let { contents } = getConfigurationModel();
        expect(contents.foo.bar).toBe(1);
        expect(contents.bar.foo).toBe(2);
        expect(contents.schema).toEqual({ 'https://example.com': '*.yaml' });
    });
    it('should update user config #1', () => {
        let conf = new configuration_1.default();
        let fn = jest.fn();
        conf.onDidChange(e => {
            expect(e.affectsConfiguration('x')).toBe(true);
            fn();
        });
        conf.updateUserConfig({ x: 1 });
        let config = conf.configuration.user;
        expect(config.contents).toEqual({ x: 1 });
        expect(fn).toBeCalled();
    });
    it('should update user config #2', () => {
        let conf = new configuration_1.default();
        conf.updateUserConfig({ x: 1 });
        conf.updateUserConfig({ x: undefined });
        let config = conf.configuration.user;
        expect(config.contents).toEqual({});
    });
    it('should update workspace config', () => {
        let conf = new configuration_1.default();
        conf.updateUserConfig({ foo: { bar: 1 } });
        let curr = conf.getConfiguration('foo');
        curr.update('bar', 2, false);
        curr = conf.getConfiguration('foo');
        let n = curr.get('bar');
        expect(n).toBe(2);
    });
    it('should handle errors', () => {
        let tmpFile = path_1.default.join(os_1.default.tmpdir(), uuidv1());
        fs_1.default.writeFileSync(tmpFile, '{"x":', 'utf8');
        let conf = new configuration_1.default(tmpFile);
        let errors = conf.errorItems;
        expect(errors.length > 1).toBe(true);
        conf.dispose();
    });
    it('should change to new folder configuration', () => {
        let conf = new configuration_1.default();
        conf.addFolderFile(workspaceConfigFile);
        let configFile = path_1.default.join(__dirname, './settings.json');
        conf.addFolderFile(configFile);
        let file = path_1.default.resolve(__dirname, '../sample/tmp.js');
        let fn = jest.fn();
        conf.onDidChange(fn);
        conf.setFolderConfiguration(vscode_uri_1.URI.file(file).toString());
        let { contents } = conf.workspace;
        expect(contents.foo).toBeUndefined();
        expect(fn).toBeCalled();
        conf.dispose();
    });
    it('should get nested property', () => {
        let config = createConfigurations();
        let conf = config.getConfiguration('servers.c');
        let res = conf.get('trace.server', '');
        expect(res).toBe('verbose');
        config.dispose();
    });
    it('should get user and workspace configuration', () => {
        let userConfigFile = path_1.default.join(__dirname, './settings.json');
        let configurations = new configuration_1.default(userConfigFile);
        let data = configurations.configuration.toData();
        expect(data.user).toBeDefined();
        expect(data.workspace).toBeDefined();
        expect(data.defaults).toBeDefined();
        let value = configurations.configuration.getValue();
        expect(value.foo).toBeDefined();
        expect(value.foo.bar).toBe(1);
        configurations.dispose();
    });
    it('should override with new value', () => {
        let configurations = createConfigurations();
        configurations.configuration.defaults.setValue('foo', 1);
        let { contents } = configurations.defaults;
        expect(contents.foo).toBe(1);
        configurations.dispose();
    });
    it('should extends defaults', () => {
        let configurations = createConfigurations();
        configurations.extendsDefaults({ 'a.b': 1 });
        configurations.extendsDefaults({ 'a.b': 2 });
        let o = configurations.defaults.contents;
        expect(o.a.b).toBe(2);
        configurations.dispose();
    });
    it('should update configuration', async () => {
        let configurations = createConfigurations();
        configurations.addFolderFile(workspaceConfigFile);
        let fn = jest.fn();
        configurations.onDidChange(e => {
            expect(e.affectsConfiguration('foo')).toBe(true);
            expect(e.affectsConfiguration('foo.bar')).toBe(true);
            expect(e.affectsConfiguration('foo.bar', 'file://tmp/foo.js')).toBe(false);
            fn();
        });
        let config = configurations.getConfiguration('foo');
        let o = config.get('bar');
        expect(o).toBe(1);
        config.update('bar', 6);
        config = configurations.getConfiguration('foo');
        expect(config.get('bar')).toBe(6);
        expect(fn).toBeCalledTimes(1);
        configurations.dispose();
    });
    it('should remove configuration', async () => {
        let configurations = createConfigurations();
        configurations.addFolderFile(workspaceConfigFile);
        let fn = jest.fn();
        configurations.onDidChange(e => {
            expect(e.affectsConfiguration('foo')).toBe(true);
            expect(e.affectsConfiguration('foo.bar')).toBe(true);
            fn();
        });
        let config = configurations.getConfiguration('foo');
        let o = config.get('bar');
        expect(o).toBe(1);
        config.update('bar', null, true);
        config = configurations.getConfiguration('foo');
        expect(config.get('bar')).toBeUndefined();
        expect(fn).toBeCalledTimes(1);
        configurations.dispose();
    });
});
describe('parse configuration', () => {
    it('should only split top level dot keys', () => {
        let o = { 'x.y': 'foo' };
        let [, contents] = util_1.parseConfiguration(JSON.stringify(o));
        expect(contents).toEqual({ x: { y: 'foo' } });
        let schema = { 'my.schema': { 'foo.bar': 1 } };
        let [, obj] = util_1.parseConfiguration(JSON.stringify(schema));
        expect(obj).toEqual({ my: { schema: { 'foo.bar': 1 } } });
    });
});
//# sourceMappingURL=configurations.test.js.map