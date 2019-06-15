"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const neovim_1 = require("@chemzqm/neovim");
const log4js_1 = tslib_1.__importDefault(require("log4js"));
const events_1 = tslib_1.__importDefault(require("./events"));
const plugin_1 = tslib_1.__importDefault(require("./plugin"));
const semver_1 = tslib_1.__importDefault(require("semver"));
require("./util/extensions");
const logger = require('./util/logger')('attach');
const isTest = process.env.NODE_ENV == 'test';
exports.default = (opts, requestApi = true) => {
    const nvim = neovim_1.attach(opts, log4js_1.default.getLogger('node-client'), requestApi);
    const plugin = new plugin_1.default(nvim);
    let clientReady = false;
    let initialized = false;
    nvim.on('notification', async (method, args) => {
        switch (method) {
            case 'VimEnter': {
                if (!initialized && clientReady) {
                    initialized = true;
                    await plugin.init();
                }
                break;
            }
            case 'TaskExit':
            case 'TaskStderr':
            case 'TaskStdout':
            case 'GlobalChange':
            case 'InputChar':
            case 'OptionSet':
                await events_1.default.fire(method, args);
                break;
            case 'CocAutocmd':
                await events_1.default.fire(args[0], args.slice(1));
                break;
            default:
                const m = method[0].toLowerCase() + method.slice(1);
                if (typeof plugin[m] == 'function') {
                    try {
                        await Promise.resolve(plugin[m].apply(plugin, args));
                    }
                    catch (e) {
                        // tslint:disable-next-line:no-console
                        console.error(`error on notification '${method}': ${e}`);
                    }
                }
        }
    });
    nvim.on('request', async (method, args, resp) => {
        try {
            if (method == 'CocAutocmd') {
                await events_1.default.fire(args[0], args.slice(1));
                resp.send();
                return;
            }
            let m = method[0].toLowerCase() + method.slice(1);
            if (typeof plugin[m] !== 'function') {
                return resp.send(`Method ${m} not found`, true);
            }
            if (!plugin.isReady) {
                await plugin.ready;
            }
            let res = await Promise.resolve(plugin[m].apply(plugin, args));
            resp.send(res);
        }
        catch (e) {
            logger.error(`Error on "${method}": ` + e.stack);
            resp.send(e.message, true);
        }
    });
    nvim.channelId.then(async (channelId) => {
        clientReady = true;
        if (isTest)
            nvim.command(`let g:coc_node_channel_id = ${channelId}`, true);
        let json = require('../package.json');
        let { major, minor, patch } = semver_1.default.parse(json.version);
        nvim.setClientInfo('coc', { major, minor, patch }, 'remote', {}, {});
        let entered = await nvim.getVvar('vim_did_enter');
        if (entered && !initialized) {
            initialized = true;
            await plugin.init();
        }
    }).catch(e => {
        console.error(`Channel create error: ${e.message}`); // tslint:disable-line
    });
    return plugin;
};
//# sourceMappingURL=attach.js.map