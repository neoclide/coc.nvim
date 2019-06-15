"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chars_1 = require("../../model/chars");
describe('chars keyword option', () => {
    it('should match @', () => {
        let chars = new chars_1.Chars('@');
        expect(chars.isKeywordChar('a')).toBe(true);
        expect(chars.isKeywordChar('z')).toBe(true);
        expect(chars.isKeywordChar('A')).toBe(true);
        expect(chars.isKeywordChar('Z')).toBe(true);
    });
    it('should match letter range', () => {
        let chars = new chars_1.Chars('a-z');
        expect(chars.isKeywordChar('a')).toBe(true);
        expect(chars.isKeywordChar('A')).toBe(false);
    });
    it('should match code range', () => {
        let chars = new chars_1.Chars('48-57');
        expect(chars.isKeywordChar('a')).toBe(false);
        expect(chars.isKeywordChar('0')).toBe(true);
        expect(chars.isKeywordChar('9')).toBe(true);
    });
    it('should match @-@', () => {
        let chars = new chars_1.Chars('@-@');
        expect(chars.isKeywordChar('@')).toBe(true);
    });
    it('should match single code', () => {
        let chars = new chars_1.Chars('58');
        expect(chars.isKeywordChar(':')).toBe(true);
    });
    it('should match single character', () => {
        let chars = new chars_1.Chars('_');
        expect(chars.isKeywordChar('_')).toBe(true);
    });
});
describe('chars addKeyword', () => {
    it('should add keyword', () => {
        let chars = new chars_1.Chars('_');
        chars.addKeyword(':');
        expect(chars.isKeywordChar(':')).toBe(true);
    });
});
describe('chars change keyword', () => {
    it('should change keyword', () => {
        let chars = new chars_1.Chars('_');
        chars.setKeywordOption(':');
        expect(chars.isKeywordChar(':')).toBe(true);
        expect(chars.isKeywordChar('_')).toBe(false);
    });
});
describe('chars match keywords', () => {
    it('should match keywords', () => {
        let chars = new chars_1.Chars('@');
        let res = chars.matchKeywords('foo bar');
        expect(res).toEqual(['foo', 'bar']);
    });
    it('should consider unicode character as word', () => {
        let chars = new chars_1.Chars('@');
        let res = chars.matchKeywords('blackкофе');
        expect(res).toEqual(['blackкофе']);
    });
});
describe('chars isKeyword', () => {
    it('should check isKeyword', () => {
        let chars = new chars_1.Chars('@');
        expect(chars.isKeyword('foo')).toBe(true);
        expect(chars.isKeyword('f@')).toBe(false);
    });
});
//# sourceMappingURL=chars.test.js.map