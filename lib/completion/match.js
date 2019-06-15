"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzy_1 = require("../util/fuzzy");
function nextWordIndex(start = 0, codes) {
    if (start == 0 && fuzzy_1.wordChar(codes[0]))
        return 0;
    start = start == 0 ? 1 : start;
    let pre = codes[start - 1];
    for (let i = start; i < codes.length; i++) {
        const ch = codes[i];
        if (fuzzy_1.wordChar(ch)) {
            if (!fuzzy_1.wordChar(pre) || (ch >= 65 && ch <= 90 && pre >= 97 && pre <= 122)) {
                return i;
            }
        }
        pre = ch;
    }
    return -1;
}
/**
 * Rules:
 * - First strict 5, first case match 2.5
 * - First word character strict 2.5, first word character case 2
 * - First fuzzy match strict 1, first fuzzy case 0.5
 * - Follow strict 1, follow case 0.5
 * - Follow word start 1, follow word case 0.75
 * - First fuzzy strict 0.1, first fuzzy case 0.05
 *
 * @public
 * @param {string} word
 * @param {number[]} input
 * @returns {number}
 */
function matchScore(word, input) {
    if (input.length == 0 || word.length < input.length)
        return 0;
    let codes = fuzzy_1.getCharCodes(word);
    let curr = codes[0];
    let score = 0;
    let first = input[0];
    let idx = 1;
    let allowFuzzy = true;
    if (!fuzzy_1.wordChar(first)) {
        if (first != codes[0])
            return 0;
        score = 5;
        idx = 1;
    }
    else {
        if (fuzzy_1.caseMatch(first, curr)) {
            score = first == curr ? 5 : 2.5;
            idx = 1;
        }
        else {
            // first word 2.5/2
            let next = nextWordIndex(1, codes);
            if (next != -1) {
                if (fuzzy_1.caseMatch(first, codes[next])) {
                    score = first == codes[next] ? 2.5 : 2;
                    idx = next + 1;
                }
            }
            if (score == 0) {
                // first fuzzy 1/0.5
                for (let i = 1; i < codes.length; i++) {
                    if (fuzzy_1.caseMatch(first, codes[i])) {
                        score = first == codes[i] ? 1 : 0.5;
                        idx = i + 1;
                        allowFuzzy = false;
                    }
                }
            }
        }
    }
    if (input.length == 1 || score == 0)
        return score;
    let next = nextScore(codes, idx, input.slice(1), allowFuzzy);
    return next == 0 ? 0 : score + next;
}
exports.matchScore = matchScore;
function nextScore(codes, index, inputCodes, allowFuzzy = true) {
    if (index >= codes.length)
        return 0;
    let scores = [];
    let input = inputCodes[0];
    let len = codes.length;
    let isFinal = inputCodes.length == 1;
    if (!fuzzy_1.wordChar(input)) {
        for (let i = index; i < len; i++) {
            if (codes[i] == input) {
                if (isFinal)
                    return 1;
                let next = nextScore(codes, i + 1, inputCodes.slice(1), allowFuzzy);
                return next == 0 ? 0 : 1 + next;
            }
        }
        return 0;
    }
    let curr = codes[index];
    let match = fuzzy_1.caseMatch(input, curr);
    if (match) {
        let score = input == curr ? 1 : 0.5;
        if (!isFinal) {
            let next = nextScore(codes, index + 1, inputCodes.slice(1), allowFuzzy);
            score = next == 0 ? 0 : score + next;
        }
        scores.push(score);
    }
    // find word start match
    let idx = nextWordIndex(index + 1, codes);
    if (idx !== -1) {
        let next = codes[idx];
        if (fuzzy_1.caseMatch(input, next)) {
            let score = input == next ? 1 : 0.75;
            if (!isFinal) {
                let next = nextScore(codes, idx + 1, inputCodes.slice(1), allowFuzzy);
                score = next == 0 ? 0 : score + next;
            }
            scores.push(score);
        }
    }
    // find fuzzy
    if (!match && allowFuzzy) {
        for (let i = index + 1; i < len; i++) {
            let code = codes[i];
            if (fuzzy_1.caseMatch(input, code)) {
                let score = input == code ? 0.1 : 0.05;
                if (!isFinal) {
                    let next = nextScore(codes, i + 1, inputCodes.slice(1), false);
                    score = next == 0 ? 0 : score + next;
                }
                scores.push(score);
            }
        }
    }
    if (!scores.length)
        return 0;
    return Math.max(...scores);
}
//# sourceMappingURL=match.js.map