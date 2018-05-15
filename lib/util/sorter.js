"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function wordSortItems(items, input) {
    return items.sort((a, b) => {
        let wa = (a.abbr || a.word).toLowerCase();
        let wb = (b.abbr || b.word).toLowerCase();
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