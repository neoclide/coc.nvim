"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzysearch = require("fuzzysearch");
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