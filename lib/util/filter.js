"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzaldrin_1 = require("fuzzaldrin");
function filterWord(words, input) {
    let len = input.length;
    return words.filter(w => w.slice(0, len).toLowerCase() === input.toLowerCase());
}
exports.filterWord = filterWord;
function filterFuzzy(words, input) {
    if (input.length === 1)
        return filterWord(words, input);
    return fuzzaldrin_1.filter(words, input);
}
exports.filterFuzzy = filterFuzzy;
function filterItemWord(items, input) {
    let len = input.length;
    let s = input.toLowerCase();
    return items.filter(item => {
        return item.word.slice(0, len).toLowerCase() === s;
    });
}
exports.filterItemWord = filterItemWord;
function filterItemFuzzy(items, input) {
    return fuzzaldrin_1.filter(items, input, { key: 'word' });
}
exports.filterItemFuzzy = filterItemFuzzy;
//# sourceMappingURL=filter.js.map