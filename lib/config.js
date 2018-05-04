"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./util/logger");
let config = {
    fuzzyMatch: true,
    keywordsRegex: /[\w-_$]{2,}/gi,
    noTrace: false,
    timeout: 300,
    sources: ['buffer', 'dictionary', 'path'],
};
function setConfig(opts) {
    let keys = ['fuzzyMatch', 'noTrace'];
    for (let key of keys) {
        let val = opts[key];
        if (val != null) {
            config[key] = !!val;
        }
    }
    if (opts.timeout) {
        config.timeout = parseInt(opts.timeout, 10);
    }
    let regex = opts.keywordsRegex;
    if (regex && typeof regex === 'string') {
        config.keywordsRegex = new RegExp(regex, 'gi');
    }
    if (opts.sources && Array.isArray(opts.sources)) {
        config.sources = opts.sources;
    }
    logger_1.logger.debug(`config:${JSON.stringify(opts)}`);
}
exports.setConfig = setConfig;
function getConfig(name) {
    return config[name];
}
exports.getConfig = getConfig;
//# sourceMappingURL=config.js.map