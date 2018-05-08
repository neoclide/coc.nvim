"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./util/logger");
let config = {
    fuzzyMatch: true,
    noTrace: false,
    timeout: 300,
    completeOpt: 'menu,preview',
    sources: ['around', 'buffer', 'dictionary', 'path'],
    disabled: [],
};
function setConfig(opts) {
    for (let key of Object.keys(opts)) {
        let val = opts[key];
        if (['fuzzyMatch', 'noTrace'].indexOf(key) !== -1) {
            if (val != null) {
                config[key] = !!val;
            }
        }
        if (key === 'timeout') {
            config.timeout = Number(opts.timeout);
            if (isNaN(config.timeout))
                config.timeout = 300;
        }
        if (key === 'sources' && Array.isArray(opts.sources)) {
            config.sources = config.sources.concat(opts.sources);
        }
        if (key === 'completeOpt') {
            config.completeOpt = opts.completeOpt;
        }
    }
    logger_1.logger.debug(`config:${JSON.stringify(config)}`);
}
exports.setConfig = setConfig;
function getConfig(name) {
    return config[name];
}
exports.getConfig = getConfig;
function toggleSource(name) {
    let { disabled } = config;
    if (disabled.indexOf(name) !== -1) {
        disabled.push(name);
    }
    else {
        let idx = disabled.findIndex(s => s === name);
        disabled.splice(idx, 1);
    }
}
exports.toggleSource = toggleSource;
//# sourceMappingURL=config.js.map