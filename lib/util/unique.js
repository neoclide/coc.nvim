"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function fieldCompare(one, other) {
    if (one && !other)
        return true;
    if (other && !one)
        return false;
    return one > other;
}
function isEqual(one, other) {
    if (!one && !other)
        return true;
    return one === other;
}
function uniqueItems(results) {
    return results.filter((item, index) => {
        let { word, kind, info, abbr } = item;
        let better = results.find((obj, idx) => {
            if (obj.word !== word)
                return false;
            if (!isEqual(obj.kind, kind))
                return fieldCompare(obj.kind, kind);
            if (!isEqual(obj.info, info))
                return fieldCompare(obj.info, info);
            if (!isEqual(obj.abbr, abbr))
                return fieldCompare(obj.abbr, abbr);
            return idx < index;
        });
        return better == null ? true : false;
    });
}
exports.uniqueItems = uniqueItems;
function hasBetter(word, abbr, info, kind, list) {
    return list.findIndex(item => {
        if (word !== item.word)
            return false;
        if (!isEqual(item.kind, kind))
            return fieldCompare(item.kind, kind);
        if (!isEqual(item.info, info))
            return fieldCompare(item.info, info);
        if (!isEqual(item.abbr, abbr))
            return fieldCompare(item.abbr, abbr);
        return true;
    }) !== -1;
}
exports.hasBetter = hasBetter;
//# sourceMappingURL=unique.js.map