"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const fuzzy_1 = require("./fuzzy");
// first is start or path start +1, fuzzy +0.5
// next is followed of path start +1, fuzzy +0.5
// filename startsWith +1, fuzzy +0.5
function getMatchResult(text, query, filename = '') {
    if (!query)
        return { score: 1 };
    let matches = [];
    let codes = fuzzy_1.getCharCodes(query);
    let filenameIdx = filename ? text.indexOf(filename) : -1;
    let matchBase = filenameIdx != -1 && fuzzy_1.fuzzyMatch(codes, filename);
    let score = 0;
    let c = query[0];
    let idx = 0;
    // base => start => pathSeparator => fuzzy
    if (matchBase) {
        if (filename.startsWith(c)) {
            score = score + 2;
            idx = filenameIdx + 1;
            matches.push(filenameIdx);
        }
        else if (filename[0].toLowerCase() == c) {
            score = score + 1.5;
            idx = filenameIdx + 1;
            matches.push(filenameIdx);
        }
        else {
            for (let i = 1; i < filename.length; i++) {
                if (fuzzy_1.fuzzyChar(c, filename[i])) {
                    score = score + 1;
                    idx = filenameIdx + i + 1;
                    matches.push(filenameIdx + i);
                    break;
                }
            }
        }
    }
    else if (text.startsWith(c)) {
        score = score + 1;
        matches.push(0);
        idx = 1;
    }
    else {
        for (let i = 1; i < text.length; i++) {
            let pre = text[i - 1];
            if (pre == path_1.sep && text[i] == c) {
                score = score + 1;
                matches.push(i);
                idx = i + 1;
                break;
            }
        }
        if (idx == 0) {
            for (let i = 0; i < text.length; i++) {
                if (fuzzy_1.fuzzyChar(c, text[i])) {
                    score = score + 0.5;
                    matches.push(i);
                    idx = i + 1;
                    break;
                }
            }
        }
    }
    if (idx == 0)
        return { score: 0 };
    if (codes.length == 1)
        return { score, matches };
    return nextResult(codes.slice(1), text, idx, { score, matches });
}
exports.getMatchResult = getMatchResult;
/**
 *
 * @public
 * @param {number[]} codes - remain codes
 * @param {string} text - total text
 * @param {number} idx - start index of text
 * @param {MatchResult} curr - current result
 * @returns {MatchResult | null}
 */
function nextResult(codes, text, idx, curr) {
    let { score, matches } = curr;
    let results = [];
    let c = codes[0];
    let remain = codes.slice(1);
    let result;
    function getRemianResult(index) {
        if (!result)
            return;
        if (remain.length == 0) {
            results.push(result);
        }
        else if (result) {
            let res = nextResult(remain, text, index, result);
            if (res)
                results.push(res);
        }
    }
    let followed = idx < text.length ? text[idx].charCodeAt(0) : null;
    if (!followed)
        return null;
    if (followed == c) {
        result = { score: score + 1, matches: matches.concat([idx]) };
        getRemianResult(idx + 1);
    }
    else if (fuzzy_1.caseMatch(c, followed)) {
        result = { score: score + 0.5, matches: matches.concat([idx]) };
        getRemianResult(idx + 1);
    }
    if (idx + 1 < text.length) {
        // follow path
        for (let i = idx + 1; i < text.length; i++) {
            let ch = text[i].charCodeAt(0);
            if (text[i - 1] == path_1.sep && fuzzy_1.caseMatch(c, ch)) {
                let add = c == ch ? 1 : 0.5;
                result = { score: score + add, matches: matches.concat([i]) };
                getRemianResult(i + 1);
                break;
            }
        }
        // next fuzzy
        for (let i = idx + 1; i < text.length; i++) {
            let ch = text[i].charCodeAt(0);
            if (fuzzy_1.caseMatch(c, ch)) {
                let add = c == ch ? 0.5 : 0.2;
                result = { score: score + add, matches: matches.concat([i]) };
                getRemianResult(i + 1);
                break;
            }
        }
    }
    return results.length ? bestResult(results) : null;
}
function bestResult(results) {
    let res = results[0];
    for (let i = 1; i < results.length; i++) {
        if (results[i].score > res.score) {
            res = results[i];
        }
    }
    return res;
}
//# sourceMappingURL=score.js.map