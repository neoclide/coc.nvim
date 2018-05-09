"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./util/logger");
let config = {
    fuzzyMatch: true,
    traceError: false,
    checkGit: false,
    timeout: 300,
    completeOpt: 'menu,preview',
    disabled: [],
    sources: {},
};
function setConfig(opts) {
    for (let key of Object.keys(opts)) {
        let val = opts[key];
        if (['fuzzyMatch', 'traceError', 'checkGit'].indexOf(key) !== -1) {
            if (val != null) {
                config[key] = !!val;
            }
        }
        if (key === 'timeout') {
            config.timeout = Number(opts.timeout);
            if (isNaN(config.timeout))
                config.timeout = 300;
        }
        if (key === 'completeOpt') {
            config.completeOpt = opts.completeOpt;
        }
        if (key === 'disabled' && Array.isArray(opts.disabled)) {
            config.disabled = opts.disabled;
        }
    }
    logger_1.logger.debug(`config:${JSON.stringify(config)}`);
}
exports.setConfig = setConfig;
function getConfig(name) {
    return config[name];
}
exports.getConfig = getConfig;
function configSource(name, opt) {
    let { disabled, filetypes, shortcut } = opt;
    let { sources } = config;
    sources[name] = sources[name] || {};
    if (disabled === 1) {
        if (config.disabled.indexOf(name) == -1) {
            config.disabled.push(name);
        }
    }
    if (disabled === 0) {
        let idx = config.disabled.findIndex(s => s == name);
        config.disabled.splice(idx, 1);
    }
    if (Array.isArray(filetypes)) {
        sources[name].filetypes = filetypes;
    }
    if (typeof shortcut == 'string') {
        sources[name].shortcut = shortcut;
    }
}
exports.configSource = configSource;
function getSourceConfig(name) {
    let { sources } = config;
    let obj = sources[name];
    if (!obj || Object.keys(obj).length === 0)
        return null;
    return obj;
}
exports.getSourceConfig = getSourceConfig;
function toggleSource(name) {
    let { disabled } = config;
    if (disabled.indexOf(name) == -1) {
        disabled.push(name);
        return 'disabled';
    }
    let idx = disabled.findIndex(s => s === name);
    disabled.splice(idx, 1);
    return 'enabled';
}
exports.toggleSource = toggleSource;
//# sourceMappingURL=config.js.map