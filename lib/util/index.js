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
function getKeywordsRegEx(keywordOption) {
    let parts = keywordOption.split(',');
    let str = '';
    for (let part of parts) {
        if (part == '@') {
            str += 'A-Za-z';
        }
        else if (part.length == 1) {
            str += part.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
        }
        else if (/^\d+-\d+$/.test(part)) {
            let ms = part.match(/^(\d+)-(\d+)$/);
            str += `${String.fromCharCode(Number(ms[1]))}-${String.fromCharCode(Number(ms[2]))}`;
        }
    }
    return new RegExp(`[${str}]{2,}`, 'gi');
}
exports.getKeywordsRegEx = getKeywordsRegEx;
//# sourceMappingURL=index.js.map