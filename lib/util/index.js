"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce = require("debounce");
const logger = require('./logger')();
function escapeSingleQuote(str) {
    return str.replace(/'/g, "''");
}
function equalChar(a, b, icase) {
    if (icase)
        return a.toLowerCase() === b.toLowerCase();
    return a === b;
}
exports.equalChar = equalChar;
// create dobounce funcs for each arg
function contextDebounce(func, timeout) {
    let funcMap = {};
    return (arg) => {
        let fn = funcMap[arg];
        if (fn == null) {
            fn = debounce(func.bind(null, arg), timeout, true);
            funcMap[arg] = fn;
        }
        fn(arg);
    };
}
exports.contextDebounce = contextDebounce;
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
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
//# sourceMappingURL=index.js.map