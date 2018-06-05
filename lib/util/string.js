"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// nvim use utf8
function byteLength(str) {
    let buf = Buffer.from(str, 'utf8');
    return buf.length;
}
exports.byteLength = byteLength;
function byteIndex(content, index) {
    let s = content.slice(0, index);
    return byteLength(s);
}
exports.byteIndex = byteIndex;
function unicodeIndex(content, index) {
    return byteSlice(content, 0, index).length;
}
exports.unicodeIndex = unicodeIndex;
function byteSlice(content, start, end) {
    let buf = Buffer.from(content, 'utf8');
    return buf.slice(start, end).toString('utf8');
}
exports.byteSlice = byteSlice;
//# sourceMappingURL=string.js.map