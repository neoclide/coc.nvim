"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./util/logger");
let config = {
    fuzzyMatch: true,
    noTrace: false,
    timeout: 300,
    completeOpt: 'menu,preview',
    sources: ['buffer', 'dictionary', 'path'],
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
        if (key === 'source' && Array.isArray(opts.sources)) {
            config.sources = val;
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
//# sourceMappingURL=config.js.map