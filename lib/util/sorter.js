"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzaldrin_1 = require("fuzzaldrin");
function fuzzySort(words, input) {
    return words.sort((a, b) => {
        return fuzzaldrin_1.score(b, input) - fuzzaldrin_1.score(a, input);
    });
}
exports.fuzzySort = fuzzySort;
//# sourceMappingURL=sorter.js.map