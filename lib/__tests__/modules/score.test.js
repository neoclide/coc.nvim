"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const score_1 = require("../../util/score");
describe('match result', () => {
    it('should respect filename #1', () => {
        let res = score_1.getMatchResult('/coc.nvim/coc.txt', 'coc', 'coc.txt');
        expect(res).toEqual({ score: 4, matches: [10, 11, 12] });
    });
    it('should respect filename #2', () => {
        let res = score_1.getMatchResult('/coc.nvim/Coc.txt', 'coc', 'Coc.txt');
        expect(res).toEqual({ score: 3.5, matches: [10, 11, 12] });
    });
    it('should respect filename #3', () => {
        let res = score_1.getMatchResult('/coc.nvim/cdoxc.txt', 'coc', 'cdoxc.txt');
        expect(res).toEqual({ score: 3, matches: [10, 12, 14] });
    });
    it('should respect path start', () => {
        let res = score_1.getMatchResult('/foob/baxr/xyz', 'fbx');
        expect(res).toEqual({ score: 3, matches: [1, 6, 11] });
    });
    it('should find fuzzy result', () => {
        let res = score_1.getMatchResult('foobarzyx', 'fbx');
        expect(res).toEqual({ score: 2, matches: [0, 3, 8] });
    });
    it('should find fuzzy result #1', () => {
        let res = score_1.getMatchResult('LICENSES/preferred/MIT', 'lsit');
        expect(res).toEqual({ score: 1.4, matches: [0, 5, 20, 21] });
    });
});
//# sourceMappingURL=score.test.js.map