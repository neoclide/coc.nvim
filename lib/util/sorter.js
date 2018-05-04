"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzaldrin_1 = require("fuzzaldrin");
function fuzzySort(words, input) {
    return words.sort((a, b) => {
        return fuzzaldrin_1.score(b, input) - fuzzaldrin_1.score(a, input);
    });
}
exports.fuzzySort = fuzzySort;
function wordSort(words, input) {
    return words.sort();
}
exports.wordSort = wordSort;
function fuzzySortItems(items, input) {
    return items.sort((a, b) => {
        return fuzzaldrin_1.score(b.word, input) - fuzzaldrin_1.score(a.word, input);
    });
}
exports.fuzzySortItems = fuzzySortItems;
function wordSortItems(items, input) {
    return items.sort((a, b) => {
        let wa = a.word.toLowerCase();
        let wb = b.word.toLowerCase();
        if (wa < wb) {
            return -1;
        }
        if (wa > wb) {
            return 1;
        }
        return 0;
    });
}
exports.wordSortItems = wordSortItems;
//# sourceMappingURL=sorter.js.map