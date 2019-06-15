"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fb_watchman_1 = tslib_1.__importDefault(require("fb-watchman"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const uuidv1 = require("uuid/v1");
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const logger = require('./util/logger')('watchman');
const requiredCapabilities = ['relative_root', 'cmd-watch-project', 'wildmatch'];
const clientsMap = new Map();
/**
 * Watchman wrapper for fb-watchman client
 *
 * @public
 */
class Watchman {
    constructor(binaryPath, channel) {
        this.channel = channel;
        this._disposed = false;
        this.client = new fb_watchman_1.default.Client({
            watchmanBinaryPath: binaryPath
        });
        this.client.setMaxListeners(300);
    }
    checkCapability() {
        let { client } = this;
        return new Promise((resolve, reject) => {
            client.capabilityCheck({
                optional: [],
                required: requiredCapabilities
            }, (error, resp) => {
                if (error)
                    return reject(error);
                let { capabilities } = resp;
                for (let key of Object.keys(capabilities)) {
                    if (!capabilities[key])
                        return resolve(false);
                }
                resolve(true);
            });
        });
    }
    async watchProject(root) {
        try {
            let resp = await this.command(['watch-project', root]);
            let { watch, warning, relative_path } = resp;
            if (warning)
                logger.warn(warning);
            this.watch = watch;
            this.relative_path = relative_path;
            logger.info(`watchman watching project: ${root}`);
            this.appendOutput(`watchman watching project: ${root}`);
        }
        catch (e) {
            logger.error(e);
            return false;
        }
        return true;
    }
    command(args) {
        return new Promise((resolve, reject) => {
            this.client.command(args, (error, resp) => {
                if (error)
                    return reject(error);
                resolve(resp);
            });
        });
    }
    async subscribe(globPattern, cb) {
        let { watch, relative_path } = this;
        if (!watch) {
            this.appendOutput(`watchman not watching: ${watch}`, 'Error');
            return null;
        }
        let { clock } = await this.command(['clock', watch]);
        let uid = uuidv1();
        let sub = {
            expression: ['allof', ['match', globPattern, 'wholename']],
            fields: ['name', 'size', 'exists', 'type', 'mtime_ms', 'ctime_ms'],
            since: clock,
        };
        let root = watch;
        if (relative_path) {
            sub.relative_root = relative_path;
            root = path_1.default.join(watch, relative_path);
        }
        let { subscribe } = await this.command(['subscribe', watch, uid, sub]);
        if (global.hasOwnProperty('__TEST__'))
            global.subscribe = subscribe;
        this.appendOutput(`subscribing "${globPattern}" in ${root}`);
        this.client.on('subscription', resp => {
            if (!resp || resp.subscription != uid)
                return;
            let { files } = resp;
            if (!files || !files.length)
                return;
            let ev = Object.assign({}, resp);
            if (this.relative_path)
                ev.root = path_1.default.resolve(resp.root, this.relative_path);
            // resp.root = this.relative_path
            files.map(f => f.mtime_ms = +f.mtime_ms);
            this.appendOutput(`file change detected: ${JSON.stringify(ev, null, 2)}`);
            cb(ev);
        });
        return vscode_jsonrpc_1.Disposable.create(() => {
            return this.unsubscribe(subscribe);
        });
    }
    unsubscribe(subscription) {
        if (this._disposed)
            return Promise.resolve();
        let { watch } = this;
        if (!watch)
            return;
        this.appendOutput(`unsubscribe "${subscription}" in: ${watch}`);
        return this.command(['unsubscribe', watch, subscription]).catch(e => {
            logger.error(e);
        });
    }
    dispose() {
        this._disposed = true;
        this.client.removeAllListeners();
        this.client.end();
    }
    appendOutput(message, type = "Info") {
        if (this.channel) {
            this.channel.appendLine(`[${type}  - ${(new Date().toLocaleTimeString())}] ${message}`);
        }
    }
    static dispose() {
        for (let promise of clientsMap.values()) {
            promise.then(client => {
                client.dispose();
            }, _e => {
                // noop
            });
        }
    }
    static createClient(binaryPath, root, channel) {
        if (root == os_1.default.homedir() || root == '/' || path_1.default.parse(root).base == root)
            return null;
        let client = clientsMap.get(root);
        if (client)
            return client;
        let promise = new Promise(async (resolve, reject) => {
            try {
                let watchman = new Watchman(binaryPath, channel);
                let valid = await watchman.checkCapability();
                if (!valid)
                    return resolve(null);
                let watching = await watchman.watchProject(root);
                if (!watching)
                    return resolve(null);
                resolve(watchman);
            }
            catch (e) {
                reject(e);
            }
        });
        clientsMap.set(root, promise);
        return promise;
    }
}
exports.default = Watchman;
//# sourceMappingURL=watchman.js.map