"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function rangeInRange(r, range) {
    return positionInRange(r.start, range) === 0 && positionInRange(r.end, range) === 0;
}
exports.rangeInRange = rangeInRange;
function rangeOverlap(r, range) {
    let { start, end } = r;
    if (comparePosition(start, range.start) < 0 && comparePosition(end, range.end) > 0) {
        return true;
    }
    return positionInRange(start, range) == 0 || positionInRange(end, range) == 0;
}
exports.rangeOverlap = rangeOverlap;
function rangeIntersect(r, range) {
    if (positionInRange(r.start, range) == 0) {
        return true;
    }
    if (positionInRange(r.end, range) == 0) {
        return true;
    }
    if (rangeInRange(range, r)) {
        return true;
    }
    return false;
}
exports.rangeIntersect = rangeIntersect;
function lineInRange(line, range) {
    let { start, end } = range;
    return line >= start.line && line <= end.line;
}
exports.lineInRange = lineInRange;
function emptyRange(range) {
    let { start, end } = range;
    return start.line == end.line && start.character == end.character;
}
exports.emptyRange = emptyRange;
function positionInRange(position, range) {
    let { start, end } = range;
    if (comparePosition(position, start) < 0)
        return -1;
    if (comparePosition(position, end) > 0)
        return 1;
    return 0;
}
exports.positionInRange = positionInRange;
function comparePosition(position, other) {
    if (position.line > other.line)
        return 1;
    if (other.line == position.line && position.character > other.character)
        return 1;
    if (other.line == position.line && position.character == other.character)
        return 0;
    return -1;
}
exports.comparePosition = comparePosition;
function isSingleLine(range) {
    return range.start.line == range.end.line;
}
exports.isSingleLine = isSingleLine;
function getChangedPosition(start, edit) {
    let { range, newText } = edit;
    if (comparePosition(range.end, start) <= 0) {
        let lines = newText.split('\n');
        let lineCount = lines.length - (range.end.line - range.start.line) - 1;
        let characterCount = 0;
        if (range.end.line == start.line) {
            let single = isSingleLine(range) && lineCount == 0;
            let removed = single ? range.end.character - range.start.character : range.end.character;
            let added = single ? newText.length : lines[lines.length - 1].length;
            characterCount = added - removed;
        }
        return { line: lineCount, character: characterCount };
    }
    return { line: 0, character: 0 };
}
exports.getChangedPosition = getChangedPosition;
function adjustPosition(pos, edit) {
    let { range, newText } = edit;
    if (comparePosition(range.start, pos) > 1)
        return pos;
    let { start, end } = range;
    let newLines = newText.split('\n');
    let delta = (end.line - start.line) - newLines.length + 1;
    let lastLine = newLines[newLines.length - 1];
    let line = pos.line - delta;
    if (pos.line != end.line)
        return { line, character: pos.character };
    let pre = newLines.length == 1 && start.line != end.line ? start.character : 0;
    let removed = start.line == end.line && newLines.length == 1 ? end.character - start.character : end.character;
    let character = pre + pos.character + lastLine.length - removed;
    return {
        line,
        character
    };
}
exports.adjustPosition = adjustPosition;
function positionToOffset(lines, line, character) {
    let offset = 0;
    for (let i = 0; i <= line; i++) {
        if (i == line) {
            offset += character;
        }
        else {
            offset += lines[i].length + 1;
        }
    }
    return offset;
}
exports.positionToOffset = positionToOffset;
// edit a range to newText
function editRange(range, text, edit) {
    // outof range
    if (!rangeInRange(edit.range, range))
        return text;
    let { start, end } = edit.range;
    let lines = text.split('\n');
    let character = start.line == range.start.line ? start.character - range.start.character : start.character;
    let startOffset = positionToOffset(lines, start.line - range.start.line, character);
    character = end.line == range.start.line ? end.character - range.start.character : end.character;
    let endOffset = positionToOffset(lines, end.line - range.start.line, character);
    return `${text.slice(0, startOffset)}${edit.newText}${text.slice(endOffset, text.length)}`;
}
exports.editRange = editRange;
function getChangedFromEdits(start, edits) {
    let changed = { line: 0, character: 0 };
    for (let edit of edits) {
        let d = getChangedPosition(start, edit);
        changed = { line: changed.line + d.line, character: changed.character + d.character };
    }
    return changed.line == 0 && changed.character == 0 ? null : changed;
}
exports.getChangedFromEdits = getChangedFromEdits;
//# sourceMappingURL=position.js.map