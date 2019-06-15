"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fast_diff_1 = tslib_1.__importDefault(require("fast-diff"));
const string_1 = require("./string");
const logger = require('./logger')('util-diff');
function diffLines(from, to) {
    let newLines = to.split('\n');
    let oldLines = from.split('\n');
    let start = 0;
    let end = oldLines.length;
    let oldLen = end;
    let len = newLines.length;
    for (let i = 0; i <= end; i++) {
        if (newLines[i] !== oldLines[i]) {
            start = i;
            break;
        }
        if (i == end) {
            start = end;
        }
    }
    if (start != newLines.length) {
        let maxRemain = Math.min(end - start, len - start);
        for (let j = 0; j < maxRemain; j++) {
            if (oldLines[oldLen - j - 1] != newLines[len - j - 1]) {
                break;
            }
            end = end - 1;
        }
    }
    return {
        start,
        end,
        replacement: newLines.slice(start, len - (oldLen - end))
    };
}
exports.diffLines = diffLines;
function getChange(oldStr, newStr) {
    let start = 0;
    let ol = oldStr.length;
    let nl = newStr.length;
    let max = Math.min(ol, nl);
    let newText = '';
    let endOffset = 0;
    for (let i = 0; i <= max; i++) {
        if (oldStr[ol - i - 1] != newStr[nl - i - 1]) {
            endOffset = i;
            break;
        }
        if (i == max)
            return null;
    }
    max = max - endOffset;
    if (max == 0) {
        start = 0;
    }
    else {
        for (let i = 0; i <= max; i++) {
            if (oldStr[i] != newStr[i] || i == max) {
                start = i;
                break;
            }
        }
    }
    let end = ol - endOffset;
    newText = newStr.slice(start, nl - endOffset);
    return { start, end, newText };
}
exports.getChange = getChange;
function patchLine(from, to, fill = ' ') {
    if (from == to)
        return to;
    let idx = to.indexOf(from);
    if (idx !== -1)
        return fill.repeat(idx) + from;
    let result = fast_diff_1.default(from, to);
    let str = '';
    for (let item of result) {
        if (item[0] == fast_diff_1.default.DELETE) {
            // not allowed
            return to;
        }
        else if (item[0] == fast_diff_1.default.INSERT) {
            str = str + fill.repeat(string_1.byteLength(item[1]));
        }
        else {
            str = str + item[1];
        }
    }
    return str;
}
exports.patchLine = patchLine;
//# sourceMappingURL=diff.js.map