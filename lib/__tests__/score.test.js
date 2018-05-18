"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fuzzaldrin_1 = require("fuzzaldrin");
describe('score test', () => {
    it('should have higher score if case match', () => {
        let one = fuzzaldrin_1.score('Increment', 'incre');
        let two = fuzzaldrin_1.score('increment', 'incre');
        expect(two > one).toBeTruthy;
    });
});
//# sourceMappingURL=score.test.js.map