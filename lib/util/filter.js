"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzaldrin_1 = require("fuzzaldrin");
const fuzzysearch = require("fuzzysearch");
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
function filterFuzzy(input, word, icase) {
    if (!icase)
        return fuzzysearch(input, word);
    return fuzzysearch(input.toLowerCase(), word.toLowerCase());
}
exports.filterFuzzy = filterFuzzy;
function filterWord(input, word, icase) {
    if (!icase)
        return word.startsWith(input);
    return word.toLowerCase().startsWith(input.toLowerCase());
}
exports.filterWord = filterWord;
//# sourceMappingURL=filter.js.map