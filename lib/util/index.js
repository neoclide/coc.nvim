"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const debounce = require("debounce");
const logger_1 = require("./logger");
const unique = require("array-unique");
function escapeSingleQuote(str) {
    return str.replace(/'/g, "''");
}
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
    return __awaiter(this, void 0, void 0, function* () {
        return yield nvim.command(`echohl ${hl} | echomsg '[complete.nvim] ${escapeSingleQuote(line)}' | echohl None"`);
    });
}
function echoErr(nvim, line) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield echoMsg(nvim, line, 'Error');
    });
}
exports.echoErr = echoErr;
function echoWarning(nvim, line) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield echoMsg(nvim, line, 'WarningMsg');
    });
}
exports.echoWarning = echoWarning;
function echoErrors(nvim, lines) {
    return __awaiter(this, void 0, void 0, function* () {
        yield nvim.call('complete#util#print_errors', lines);
    });
}
exports.echoErrors = echoErrors;
function escapeChar(s) {
    if (/^\w/.test(s))
        return '';
    if (s === '-')
        return '\\\\-';
    if (s === '.')
        return '\\\\.';
    if (s === ':')
        return '\\\\:';
    return s;
}
function getKeywordsRegStr(keywordOption) {
    let parts = keywordOption.split(',');
    let str = '';
    let chars = [];
    parts = unique(parts);
    for (let part of parts) {
        if (part == '@') {
            str += 'A-Za-z';
        }
        else if (/^(\d+)-(\d+)$/.test(part)) {
            let ms = part.match(/^(\d+)-(\d+)$/);
            str += `${String.fromCharCode(Number(ms[1]))}-${String.fromCharCode(Number(ms[2]))}`;
        }
        else if (/^\d+$/.test(part)) {
            chars.push(escapeChar(String.fromCharCode(Number(part))));
        }
        else if (part.length == 1) {
            chars.push(escapeChar(part));
        }
    }
    str += unique(chars).join('');
    logger_1.logger.debug(`str:${str}`);
    return `[${str}]`;
}
exports.getKeywordsRegStr = getKeywordsRegStr;
//# sourceMappingURL=index.js.map