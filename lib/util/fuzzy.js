"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getCharCodes(str) {
    let res = [];
    for (let i = 0, l = str.length; i < l; i++) {
        res.push(str.charCodeAt(i));
    }
    return res;
}
exports.getCharCodes = getCharCodes;
function wordChar(ch) {
    return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90);
}
exports.wordChar = wordChar;
function caseMatch(input, code) {
    if (input == code)
        return true;
    if (input >= 97 && input <= 122 && code + 32 === input)
        return true;
    return false;
}
exports.caseMatch = caseMatch;
function fuzzyChar(a, b) {
    let ca = a.charCodeAt(0);
    let cb = b.charCodeAt(0);
    if (ca === cb)
        return true;
    if (ca >= 97 && ca <= 122 && cb + 32 === ca)
        return true;
    return false;
}
exports.fuzzyChar = fuzzyChar;
// upper case must match, lower case ignore case
function fuzzyMatch(needle, text) {
    let totalCount = needle.length;
    if (needle.length > text.length)
        return false;
    let i = 0;
    for (let j = 0; j < text.length; j++) {
        if (i === totalCount)
            break;
        let code = text.charCodeAt(j);
        let m = needle[i];
        if (code === m) {
            i = i + 1;
            continue;
        }
        // upper case match lower case
        if ((m >= 97 && m <= 122) && code + 32 === m) {
            i = i + 1;
            continue;
        }
    }
    return i === totalCount;
}
exports.fuzzyMatch = fuzzyMatch;
//# sourceMappingURL=fuzzy.js.map