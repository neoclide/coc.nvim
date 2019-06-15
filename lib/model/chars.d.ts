export declare class Range {
    start: number;
    end: number;
    constructor(start: number, end?: number);
    static fromKeywordOption(keywordOption: string): Range[];
    contains(c: number): boolean;
}
export declare class Chars {
    ranges: Range[];
    constructor(keywordOption?: string);
    addKeyword(ch: string): void;
    clone(): Chars;
    setKeywordOption(keywordOption: string): void;
    matchKeywords(content: string, min?: number): string[];
    isKeywordCode(code: number): boolean;
    isKeywordChar(ch: string): boolean;
    isKeyword(word: string): boolean;
}
