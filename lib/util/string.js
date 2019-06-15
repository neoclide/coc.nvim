"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// nvim use utf8
function byteLength(str) {
    return Buffer.byteLength(str);
}
exports.byteLength = byteLength;
function upperFirst(str) {
    return str ? str[0].toUpperCase() + str.slice(1) : '';
}
exports.upperFirst = upperFirst;
function byteIndex(content, index) {
    let s = content.slice(0, index);
    return Buffer.byteLength(s);
}
exports.byteIndex = byteIndex;
function indexOf(str, ch, count = 1) {
    let curr = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] == ch) {
            curr = curr + 1;
            if (curr == count) {
                return i;
            }
        }
    }
    return -1;
}
exports.indexOf = indexOf;
function characterIndex(content, byteIndex) {
    let buf = Buffer.from(content, 'utf8');
    return buf.slice(0, byteIndex).toString('utf8').length;
}
exports.characterIndex = characterIndex;
function byteSlice(content, start, end) {
    let buf = Buffer.from(content, 'utf8');
    return buf.slice(start, end).toString('utf8');
}
exports.byteSlice = byteSlice;
function isWord(character) {
    let code = character.charCodeAt(0);
    if (code > 128)
        return false;
    if (code == 95)
        return true;
    if (code >= 48 && code <= 57)
        return true;
    if (code >= 65 && code <= 90)
        return true;
    if (code >= 97 && code <= 122)
        return true;
    return false;
}
exports.isWord = isWord;
function isTriggerCharacter(character) {
    if (!character)
        return false;
    let code = character.charCodeAt(0);
    if (code > 128)
        return false;
    if (code >= 65 && code <= 90)
        return false;
    if (code >= 97 && code <= 122)
        return false;
    return true;
}
exports.isTriggerCharacter = isTriggerCharacter;
function resolveVariables(str, variables) {
    const regexp = /\$\{(.*?)\}/g;
    return str.replace(regexp, (match, name) => {
        const newValue = variables[name];
        if (typeof newValue === 'string') {
            return newValue;
        }
        return match;
    });
}
exports.resolveVariables = resolveVariables;
function isAsciiLetter(code) {
    if (code >= 65 && code <= 90)
        return true;
    if (code >= 97 && code <= 122)
        return true;
    return false;
}
exports.isAsciiLetter = isAsciiLetter;
function doEqualsIgnoreCase(a, b, stopAt = a.length) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    for (let i = 0; i < stopAt; i++) {
        const codeA = a.charCodeAt(i);
        const codeB = b.charCodeAt(i);
        if (codeA === codeB) {
            continue;
        }
        // a-z A-Z
        if (isAsciiLetter(codeA) && isAsciiLetter(codeB)) {
            const diff = Math.abs(codeA - codeB);
            if (diff !== 0 && diff !== 32) {
                return false;
            }
        }
        // Any other charcode
        else {
            if (String.fromCharCode(codeA).toLowerCase() !== String.fromCharCode(codeB).toLowerCase()) {
                return false;
            }
        }
    }
    return true;
}
function equalsIgnoreCase(a, b) {
    const len1 = a ? a.length : 0;
    const len2 = b ? b.length : 0;
    if (len1 !== len2) {
        return false;
    }
    return doEqualsIgnoreCase(a, b);
}
exports.equalsIgnoreCase = equalsIgnoreCase;
//# sourceMappingURL=string.js.map