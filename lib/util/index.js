"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
const debounce = require("debounce");
const net = require("net");
const logger = require('./logger')();
function escapeSingleQuote(str) {
    return str.replace(/'/g, "''");
}
function echoErr(nvim, line) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return yield echoMsg(nvim, line, 'Error');
    });
}
exports.echoErr = echoErr;
function echoWarning(nvim, line) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return yield echoMsg(nvim, line, 'WarningMsg');
    });
}
exports.echoWarning = echoWarning;
function echoErrors(nvim, lines) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield nvim.call('coc#util#print_errors', lines);
    });
}
exports.echoErrors = echoErrors;
function getUserData(item) {
    let userData = item.user_data;
    if (!userData)
        return null;
    try {
        let res = JSON.parse(userData);
        return res.hasOwnProperty('cid') ? res : null;
    }
    catch (e) {
        return null;
    }
}
exports.getUserData = getUserData;
// create dobounce funcs for each arg
function contextDebounce(func, timeout) {
    let funcMap = {};
    return (arg) => {
        let fn = funcMap[arg];
        if (fn == null) {
            fn = debounce(func.bind(null, arg), timeout, false);
            funcMap[arg.toString()] = fn;
        }
        fn(arg);
    };
}
exports.contextDebounce = contextDebounce;
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}
exports.wait = wait;
function echoMsg(nvim, line, hl) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            yield nvim.command(`echohl ${hl} | echomsg '[coc.nvim] ${escapeSingleQuote(line)}' | echohl None"`);
        }
        catch (e) {
            logger.error(e.stack);
        }
        return;
    });
}
function isCocItem(item) {
    if (!item || !item.hasOwnProperty('word'))
        return false;
    if (Object.keys(item).length == 0)
        return false;
    let hasUserData = config_1.getConfig('hasUserData');
    // NVIM doesn't support user_data
    if (!hasUserData)
        return true;
    let { user_data } = item;
    if (!user_data)
        return false;
    try {
        let res = JSON.parse(user_data);
        return res.cid != null;
    }
    catch (e) {
        return false;
    }
}
exports.isCocItem = isCocItem;
function filterWord(input, word, icase) {
    if (!icase)
        return word.startsWith(input);
    return word.toLowerCase().startsWith(input.toLowerCase());
}
exports.filterWord = filterWord;
function getValidPort(port, cb) {
    let server = net.createServer();
    server.listen(port, () => {
        server.once('close', () => {
            cb(port);
        });
        server.close();
    });
    server.on('error', () => {
        port += 1;
        getValidPort(port, cb);
    });
}
function getPort(port = 44877) {
    return new Promise(resolve => {
        getValidPort(port, result => {
            resolve(result);
        });
    });
}
exports.getPort = getPort;
//# sourceMappingURL=index.js.map