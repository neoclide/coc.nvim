"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const debounce_1 = require("debounce");
const fast_diff_1 = tslib_1.__importDefault(require("fast-diff"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const isuri_1 = tslib_1.__importDefault(require("isuri"));
const path_1 = tslib_1.__importDefault(require("path"));
const semver_1 = tslib_1.__importDefault(require("semver"));
const util_1 = tslib_1.__importDefault(require("util"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const events_1 = tslib_1.__importDefault(require("./events"));
const db_1 = tslib_1.__importDefault(require("./model/db"));
const memos_1 = tslib_1.__importDefault(require("./model/memos"));
const util_2 = require("./util");
const array_1 = require("./util/array");
const factory_1 = require("./util/factory");
const fs_2 = require("./util/fs");
const watchman_1 = tslib_1.__importDefault(require("./watchman"));
const workspace_1 = tslib_1.__importDefault(require("./workspace"));
const commands_1 = tslib_1.__importDefault(require("./commands"));
require("./util/extensions");
const createLogger = require('./util/logger');
const logger = createLogger('extensions');
const extensionFolder = global.hasOwnProperty('__TEST__') ? '' : 'node_modules';
function loadJson(file) {
    try {
        let content = fs_1.default.readFileSync(file, 'utf8');
        return JSON.parse(content);
    }
    catch (e) {
        return null;
    }
}
class Extensions {
    constructor() {
        this.list = [];
        this.disabled = new Set();
        this._onDidLoadExtension = new vscode_languageserver_protocol_1.Emitter();
        this._onDidActiveExtension = new vscode_languageserver_protocol_1.Emitter();
        this._onDidUnloadExtension = new vscode_languageserver_protocol_1.Emitter();
        this._additionalSchemes = {};
        this.activated = false;
        this.ready = true;
        this.onDidLoadExtension = this._onDidLoadExtension.event;
        this.onDidActiveExtension = this._onDidActiveExtension.event;
        this.onDidUnloadExtension = this._onDidUnloadExtension.event;
    }
    async init(nvim) {
        this.root = await nvim.call('coc#util#extension_root');
        if (!fs_1.default.existsSync(this.root)) {
            await nvim.call('coc#util#init_extension_root', this.root);
        }
        if (global.hasOwnProperty('__TEST__')) {
            this.root = path_1.default.join(__dirname, './__tests__/extensions');
        }
        let filepath = path_1.default.join(this.root, 'db.json');
        let db = this.db = new db_1.default(filepath);
        let data = loadJson(db.filepath) || {};
        let keys = Object.keys(data.extension || {});
        for (let key of keys) {
            if (data.extension[key].disabled == true) {
                this.disabled.add(key);
            }
        }
        if (process.env.COC_NO_PLUGINS)
            return;
        let stats = await this.globalExtensionStats();
        let localStats = await this.localExtensionStats(stats);
        stats = stats.concat(localStats);
        this.memos = new memos_1.default(path_1.default.resolve(this.root, '../memos.json'));
        await this.loadFileExtensions();
        await Promise.all(stats.map(stat => {
            return this.loadExtension(stat.root, stat.isLocal).catch(e => {
                workspace_1.default.showMessage(`Can't load extension from ${stat.root}: ${e.message}'`, 'error');
            });
        }));
        // watch for new local extension
        workspace_1.default.watchOption('runtimepath', async (oldValue, newValue) => {
            let result = fast_diff_1.default(oldValue, newValue);
            for (let [changeType, value] of result) {
                if (changeType == 1) {
                    let paths = value.replace(/,$/, '').split(',');
                    for (let p of paths) {
                        await this.loadExtension(p, true);
                    }
                }
            }
        });
    }
    activateExtensions() {
        this.activated = true;
        for (let item of this.list) {
            let { id, packageJSON } = item.extension;
            this.setupActiveEvents(id, packageJSON);
        }
        // check extensions need watch & install
        this.checkExtensions().logError();
        let config = workspace_1.default.getConfiguration('coc.preferences');
        let interval = config.get('extensionUpdateCheck', 'daily');
        if (interval != 'never')
            this.updateExtensions(interval).logError();
    }
    async updateExtensions(interval, force = false) {
        let now = new Date();
        let { db } = this;
        let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (interval == 'daily' ? 0 : 7));
        let ts = await db.fetch('lastUpdate');
        if (!force && ts && Number(ts) > day.getTime())
            return;
        if (global.hasOwnProperty('__TEST__') && !force)
            return;
        let stats = await this.globalExtensionStats();
        await db.push('lastUpdate', Date.now());
        let versionInfo = {};
        stats = stats.filter(o => !o.exotic);
        let yarncmd = await workspace_1.default.nvim.call('coc#util#yarn_cmd');
        for (let stat of stats) {
            if (stat.exotic)
                continue;
            let file = path_1.default.join(stat.root, 'package.json');
            let obj = loadJson(file);
            if (obj && obj.version) {
                versionInfo[stat.id] = obj.version;
            }
        }
        let outdated = [];
        await Promise.all(Object.keys(versionInfo).map(id => {
            let curr = versionInfo[id];
            return util_2.runCommand(`${yarncmd} info ${id} --json`).then(content => {
                let lines = content.trim().split('\n');
                let json = JSON.parse(lines[lines.length - 1]);
                let { version, engines } = json.data;
                if (version == curr || !engines)
                    return;
                if (engines.hasOwnProperty('coc')) {
                    let required = engines.coc.replace(/^\^/, '>=');
                    if (!semver_1.default.satisfies(workspace_1.default.version, required))
                        return;
                    if (semver_1.default.gt(version, curr)) {
                        outdated.push(id);
                    }
                }
                else {
                    outdated.push(id);
                }
            });
        }));
        if (!outdated.length)
            return;
        let status = workspace_1.default.createStatusBarItem(99, { progress: true });
        logger.info(`Upgrading ${outdated.join(' ')}`);
        status.text = `Upgrading ${outdated.join(' ')}`;
        status.show();
        if (!global.hasOwnProperty('__TEST__')) {
            await util_2.runCommand(`${yarncmd} install`, { cwd: this.root });
        }
        const child = child_process_1.spawn(yarncmd, ['upgrade', ...outdated, '--latest', '--ignore-engines'], {
            cwd: this.root,
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        child.once('exit', () => {
            status.dispose();
        });
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            child.kill('SIGKILL');
        });
    }
    async checkExtensions() {
        let { globalExtensions, watchExtensions } = workspace_1.default.env;
        if (globalExtensions && globalExtensions.length) {
            this.installExtensions(globalExtensions).catch(_e => {
                // noop
            });
        }
        // watch for changes
        if (watchExtensions && watchExtensions.length) {
            let watchmanPath = workspace_1.default.getWatchmanPath();
            if (!watchmanPath)
                return;
            let stats = await this.getExtensionStates();
            for (let name of watchExtensions) {
                let stat = stats.find(s => s.id == name);
                if (stat && stat.state !== 'disabled') {
                    let directory = await util_1.default.promisify(fs_1.default.realpath)(stat.root);
                    let client = await watchman_1.default.createClient(watchmanPath, directory);
                    client.subscribe('**/*.js', debounce_1.debounce(async () => {
                        await this.reloadExtension(name);
                        workspace_1.default.showMessage(`reloaded ${name}`);
                    }, 100)).catch(_e => {
                        // noop
                    });
                }
            }
        }
    }
    async installExtensions(list) {
        if (list && list.length) {
            let db = loadJson(this.db.filepath);
            let extension = db ? db.extension : null;
            list = array_1.distinct(list);
            list = list.filter(name => {
                if (this.has(name))
                    return false;
                if (/^\w+:/.test(name) && this.packageNameFromUrl(name))
                    return false;
                if (extension && extension[name] && extension[name].disabled == true)
                    return false;
                return true;
            });
            let cmd = global.hasOwnProperty('__TEST__') ? 'CocInstall -sync' : 'CocInstall';
            if (list.length)
                await workspace_1.default.nvim.command(`${cmd} ${list.join(' ')}`);
        }
    }
    get all() {
        return this.list.map(o => o.extension);
    }
    getExtension(id) {
        return this.list.find(o => o.id == id);
    }
    getExtensionState(id) {
        let disabled = this.isDisabled(id);
        if (disabled)
            return 'disabled';
        let item = this.list.find(o => o.id == id);
        if (!item)
            return 'unknown';
        let { extension } = item;
        return extension.isActive ? 'activated' : 'loaded';
    }
    async getExtensionStates() {
        let globalStats = await this.globalExtensionStats();
        let localStats = await this.localExtensionStats(globalStats);
        return globalStats.concat(localStats);
    }
    async toggleExtension(id) {
        let state = this.getExtensionState(id);
        if (state == null)
            return;
        if (state == 'activated') {
            this.deactivate(id);
        }
        let key = `extension.${id}.disabled`;
        await this.db.push(key, state == 'disabled' ? false : true);
        if (state != 'disabled') {
            this.disabled.add(id);
            // unload
            let idx = this.list.findIndex(o => o.id == id);
            this.list.splice(idx, 1);
        }
        else {
            this.disabled.delete(id);
            let folder = path_1.default.join(this.root, extensionFolder, id);
            try {
                await this.loadExtension(folder);
            }
            catch (e) {
                workspace_1.default.showMessage(`Can't load extension ${id}: ${e.message}'`, 'error');
            }
        }
        await util_2.wait(200);
    }
    async reloadExtension(id) {
        let idx = this.list.findIndex(o => o.id == id);
        let directory = idx == -1 ? null : this.list[idx].directory;
        this.deactivate(id);
        if (idx != -1)
            this.list.splice(idx, 1);
        await util_2.wait(200);
        if (directory) {
            await this.loadExtension(directory);
        }
        else {
            this.activate(id);
        }
    }
    async uninstallExtension(ids) {
        let status = workspace_1.default.createStatusBarItem(99, { progress: true });
        status.text = `Uninstalling ${ids.join(' ')}`;
        status.show();
        for (let id of ids) {
            if (!this.isGlobalExtension(id)) {
                workspace_1.default.showMessage(`Global extension '${id}' not found.`, 'error');
                return;
            }
            this.deactivate(id);
        }
        await util_2.wait(30);
        let yarncmd = await workspace_1.default.nvim.call('coc#util#yarn_cmd');
        if (!yarncmd)
            return;
        try {
            if (!global.hasOwnProperty('__TEST__')) {
                await workspace_1.default.runCommand(`${yarncmd} remove ${ids.join(' ')}`, this.root);
            }
            for (let id of ids) {
                let idx = this.list.findIndex(o => o.id == id);
                if (idx != -1)
                    this.list.splice(idx, 1);
                this._onDidUnloadExtension.fire(id);
            }
            status.dispose();
            workspace_1.default.showMessage(`Extensions ${ids.join(' ')} removed`);
        }
        catch (e) {
            status.dispose();
            workspace_1.default.showMessage(`Uninstall failed: ${e.message}`, 'error');
        }
    }
    isDisabled(id) {
        return this.disabled.has(id);
    }
    async onExtensionInstall(id) {
        if (/^\w+:/.test(id))
            id = this.packageNameFromUrl(id);
        if (!id || /^-/.test(id))
            return;
        let item = this.list.find(o => o.id == id);
        if (item)
            item.deactivate();
        let folder = path_1.default.join(this.root, extensionFolder, id);
        let stat = await fs_2.statAsync(folder);
        if (stat && stat.isDirectory()) {
            let jsonFile = path_1.default.join(folder, 'package.json');
            let content = await fs_2.readFile(jsonFile, 'utf8');
            let packageJSON = JSON.parse(content);
            let { engines } = packageJSON;
            if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode')))
                return;
            await this.loadExtension(folder);
        }
    }
    has(id) {
        return this.list.find(o => o.id == id) != null;
    }
    isActivted(id) {
        let item = this.list.find(o => o.id == id);
        if (item && item.extension.isActive) {
            return true;
        }
        return false;
    }
    async loadExtension(folder, isLocal = false) {
        let jsonFile = path_1.default.join(folder, 'package.json');
        let stat = await fs_2.statAsync(jsonFile);
        if (!stat || !stat.isFile())
            return;
        let content = await fs_2.readFile(jsonFile, 'utf8');
        let packageJSON = JSON.parse(content);
        if (this.isDisabled(packageJSON.name))
            return;
        if (this.isActivted(packageJSON.name)) {
            workspace_1.default.showMessage(`deactivate ${packageJSON.name}`);
            this.deactivate(packageJSON.name);
            await util_2.wait(200);
        }
        let { engines } = packageJSON;
        if (engines && engines.hasOwnProperty('coc')) {
            let required = engines.coc.replace(/^\^/, '>=');
            if (!semver_1.default.satisfies(workspace_1.default.version, required)) {
                workspace_1.default.showMessage(`Please update coc.nvim, ${packageJSON.name} requires coc.nvim ${engines.coc}`, 'warning');
            }
            this.createExtension(folder, Object.freeze(packageJSON), isLocal);
        }
        else if (engines && engines.hasOwnProperty('vscode')) {
            this.createExtension(folder, Object.freeze(packageJSON), isLocal);
        }
        else {
            logger.info(`engine coc & vscode not found in ${jsonFile}`);
        }
    }
    async loadFileExtensions() {
        if (global.hasOwnProperty('__TEST__'))
            return;
        let folder = path_1.default.join(process.env.VIMCONFIG, 'coc-extensions');
        if (!fs_1.default.existsSync(folder))
            return;
        let files = await fs_2.readdirAsync(folder);
        files = files.filter(f => f.endsWith('.js'));
        for (let file of files) {
            this.loadExtensionFile(path_1.default.join(folder, file));
        }
    }
    /**
     * Load single javascript file as extension.
     */
    loadExtensionFile(filepath) {
        let filename = path_1.default.basename(filepath);
        let name = path_1.default.basename(filepath, 'js');
        if (this.isDisabled(name))
            return;
        let root = path_1.default.dirname(filepath);
        let packageJSON = {
            name,
            main: filename,
        };
        this.createExtension(root, packageJSON);
    }
    activate(id, silent = true) {
        if (this.isDisabled(id)) {
            if (!silent)
                workspace_1.default.showMessage(`Extension ${id} is disabled!`, 'error');
            return;
        }
        let item = this.list.find(o => o.id == id);
        if (!item) {
            workspace_1.default.showMessage(`Extension ${id} not found!`, 'error');
            return;
        }
        let { extension } = item;
        if (extension.isActive)
            return;
        extension.activate().then(() => {
            if (extension.isActive) {
                this._onDidActiveExtension.fire(extension);
            }
        }, e => {
            workspace_1.default.showMessage(`Error on activate ${extension.id}: ${e.message}`, 'error');
            logger.error(`Error on activate extension ${extension.id}:`, e);
        });
    }
    deactivate(id) {
        let item = this.list.find(o => o.id == id);
        if (!item)
            return false;
        if (item.extension.isActive && typeof item.deactivate == 'function') {
            item.deactivate();
            return true;
        }
        return false;
    }
    async call(id, method, args) {
        let item = this.list.find(o => o.id == id);
        if (!item)
            return workspace_1.default.showMessage(`extension ${id} not found`, 'error');
        let { extension } = item;
        if (!extension.isActive) {
            workspace_1.default.showMessage(`extension ${id} not activated`, 'error');
            return;
        }
        let { exports } = extension;
        if (!exports || !exports.hasOwnProperty(method)) {
            workspace_1.default.showMessage(`method ${method} not found on extension ${id}`, 'error');
            return;
        }
        return await Promise.resolve(exports[method].apply(null, args));
    }
    getExtensionApi(id) {
        let item = this.list.find(o => o.id == id);
        if (!item)
            return null;
        let { extension } = item;
        return extension.isActive ? extension.exports : null;
    }
    registerExtension(extension, deactivate) {
        let { id, packageJSON } = extension;
        this.list.push({ id, extension, deactivate, isLocal: true });
        let { contributes } = packageJSON;
        if (contributes) {
            let { configuration } = contributes;
            if (configuration && configuration.properties) {
                let { properties } = configuration;
                let props = {};
                for (let key of Object.keys(properties)) {
                    let val = properties[key].default;
                    if (val != null)
                        props[key] = val;
                }
                workspace_1.default.configurations.extendsDefaults(props);
            }
        }
        this._onDidLoadExtension.fire(extension);
        this.setupActiveEvents(id, packageJSON);
    }
    get globalExtensions() {
        let json = this.loadJson();
        if (!json || !json.dependencies)
            return [];
        return Object.keys(json.dependencies);
    }
    async globalExtensionStats() {
        let json = this.loadJson();
        if (!json || !json.dependencies)
            return [];
        let res = await Promise.all(Object.keys(json.dependencies).map(key => {
            return new Promise(async (resolve) => {
                try {
                    let val = json.dependencies[key];
                    let root = path_1.default.join(this.root, extensionFolder, key);
                    let jsonFile = path_1.default.join(root, 'package.json');
                    let stat = await fs_2.statAsync(jsonFile);
                    if (!stat || !stat.isFile())
                        return resolve(null);
                    let content = await fs_2.readFile(jsonFile, 'utf8');
                    root = await fs_2.realpathAsync(root);
                    let obj = JSON.parse(content);
                    let { engines } = obj;
                    if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
                        return resolve(null);
                    }
                    let version = obj ? obj.version || '' : '';
                    let description = obj ? obj.description || '' : '';
                    resolve({
                        id: key,
                        isLocal: false,
                        version,
                        description,
                        exotic: isuri_1.default.isValid(val),
                        root,
                        state: this.getExtensionState(key)
                    });
                }
                catch (e) {
                    logger.error(e);
                    resolve(null);
                }
            });
        }));
        return res.filter(info => info != null);
    }
    async localExtensionStats(exclude) {
        let runtimepath = await workspace_1.default.nvim.eval('&runtimepath');
        let included = exclude.map(o => o.root);
        let names = exclude.map(o => o.id);
        let paths = runtimepath.split(',');
        let res = await Promise.all(paths.map(root => {
            return new Promise(async (resolve) => {
                try {
                    if (included.includes(root)) {
                        return resolve(null);
                    }
                    let jsonFile = path_1.default.join(root, 'package.json');
                    let stat = await fs_2.statAsync(jsonFile);
                    if (!stat || !stat.isFile())
                        return resolve(null);
                    let content = await fs_2.readFile(jsonFile, 'utf8');
                    let obj = JSON.parse(content);
                    let { engines } = obj;
                    if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
                        return resolve(null);
                    }
                    if (names.indexOf(obj.name) !== -1) {
                        workspace_1.default.showMessage(`Skipped extension  "${root}", please uninstall "${obj.name}" by :CocUninstall ${obj.name}`, 'warning');
                        return resolve(null);
                    }
                    let version = obj ? obj.version || '' : '';
                    let description = obj ? obj.description || '' : '';
                    resolve({
                        id: obj.name,
                        isLocal: true,
                        version,
                        description,
                        exotic: false,
                        root,
                        state: this.getExtensionState(obj.name)
                    });
                }
                catch (e) {
                    logger.error(e);
                    resolve(null);
                }
            });
        }));
        return res.filter(info => info != null);
    }
    isGlobalExtension(id) {
        return this.globalExtensions.indexOf(id) !== -1;
    }
    loadJson() {
        let { root } = this;
        let jsonFile = path_1.default.join(root, 'package.json');
        if (!fs_1.default.existsSync(jsonFile))
            return null;
        return loadJson(jsonFile);
    }
    packageNameFromUrl(url) {
        let json = this.loadJson();
        if (!json || !json.dependencies)
            return null;
        for (let key of Object.keys(json.dependencies)) {
            let val = json.dependencies[key];
            if (val == url)
                return key;
        }
        return null;
    }
    get schemes() {
        return this._additionalSchemes;
    }
    addSchemeProperty(key, def) {
        this._additionalSchemes[key] = def;
        workspace_1.default.configurations.extendsDefaults({ [key]: def.default });
    }
    setupActiveEvents(id, packageJSON) {
        let { activationEvents } = packageJSON;
        if (!activationEvents || activationEvents.indexOf('*') !== -1 || !Array.isArray(activationEvents)) {
            this.activate(id);
            return;
        }
        let active = () => {
            util_2.disposeAll(disposables);
            this.activate(id);
            active = () => { }; // tslint:disable-line
        };
        let disposables = [];
        for (let eventName of activationEvents) {
            let parts = eventName.split(':');
            let ev = parts[0];
            if (ev == 'onLanguage') {
                if (workspace_1.default.filetypes.has(parts[1])) {
                    active();
                    return;
                }
                workspace_1.default.onDidOpenTextDocument(document => {
                    if (document.languageId == parts[1]) {
                        active();
                    }
                }, null, disposables);
            }
            else if (ev == 'onCommand') {
                events_1.default.on('Command', command => {
                    if (command == parts[1]) {
                        active();
                        // wait for service ready
                        return new Promise(resolve => {
                            setTimeout(resolve, 500);
                        });
                    }
                }, null, disposables);
            }
            else if (ev == 'workspaceContains') {
                let check = () => {
                    let folders = workspace_1.default.workspaceFolders.map(o => vscode_uri_1.URI.parse(o.uri).fsPath);
                    for (let folder of folders) {
                        if (fs_2.inDirectory(folder, parts[1].split(/\s+/))) {
                            active();
                            break;
                        }
                    }
                };
                check();
                workspace_1.default.onDidChangeWorkspaceFolders(check, null, disposables);
            }
            else if (ev == 'onFileSystem') {
                for (let doc of workspace_1.default.documents) {
                    let u = vscode_uri_1.URI.parse(doc.uri);
                    if (u.scheme == parts[1]) {
                        return active();
                    }
                }
                workspace_1.default.onDidOpenTextDocument(document => {
                    let u = vscode_uri_1.URI.parse(document.uri);
                    if (u.scheme == parts[1]) {
                        active();
                    }
                }, null, disposables);
            }
            else {
                workspace_1.default.showMessage(`Unsupported event ${eventName} of ${id}`, 'error');
            }
        }
    }
    createExtension(root, packageJSON, isLocal = false) {
        let id = `${packageJSON.name}`;
        let isActive = false;
        let exports = null;
        let filename = path_1.default.join(root, packageJSON.main || 'index.js');
        let ext;
        let subscriptions = [];
        let extension = {
            activate: async () => {
                if (isActive)
                    return;
                let context = {
                    subscriptions,
                    extensionPath: root,
                    globalState: this.memos.createMemento(`${id}|global`),
                    workspaceState: this.memos.createMemento(`${id}|${workspace_1.default.rootPath}`),
                    asAbsolutePath: relativePath => {
                        return path_1.default.join(root, relativePath);
                    },
                    storagePath: path_1.default.join(this.root, `${id}-data`),
                    logger: createLogger(id)
                };
                isActive = true;
                if (!ext) {
                    try {
                        ext = factory_1.createExtension(id, filename);
                    }
                    catch (e) {
                        workspace_1.default.showMessage(`Error on load extension ${id} from ${filename}: ${e}`, 'error');
                        logger.error(e);
                        return;
                    }
                }
                try {
                    exports = await Promise.resolve(ext.activate(context));
                }
                catch (e) {
                    isActive = false;
                    workspace_1.default.showMessage(`Error on active extension ${id}: ${e}`, 'error');
                    logger.error(e);
                }
                return exports;
            }
        };
        Object.defineProperties(extension, {
            id: {
                get: () => id
            },
            packageJSON: {
                get: () => packageJSON
            },
            extensionPath: {
                get: () => root
            },
            isActive: {
                get: () => isActive
            },
            exports: {
                get: () => exports
            }
        });
        this.list.push({
            id,
            isLocal,
            extension,
            directory: root,
            deactivate: () => {
                isActive = false;
                if (ext && ext.deactivate) {
                    Promise.resolve(ext.deactivate()).catch(e => {
                        logger.error(`Error on ${id} deactivate: `, e.message);
                    });
                }
                util_2.disposeAll(subscriptions);
                subscriptions = [];
            }
        });
        let { contributes } = packageJSON;
        if (contributes) {
            let { configuration, rootPatterns, commands } = contributes;
            if (configuration && configuration.properties) {
                let { properties } = configuration;
                let props = {};
                for (let key of Object.keys(properties)) {
                    let val = properties[key].default;
                    if (val != null)
                        props[key] = val;
                }
                workspace_1.default.configurations.extendsDefaults(props);
            }
            if (rootPatterns && rootPatterns.length) {
                for (let item of rootPatterns) {
                    workspace_1.default.addRootPatterns(item.filetype, item.patterns);
                }
            }
            if (commands && commands.length) {
                for (let cmd of commands) {
                    commands_1.default.titles.set(cmd.command, cmd.title);
                }
            }
        }
        this._onDidLoadExtension.fire(extension);
        if (this.activated) {
            this.setupActiveEvents(id, packageJSON);
        }
        return id;
    }
}
exports.Extensions = Extensions;
exports.default = new Extensions();
//# sourceMappingURL=extensions.js.map