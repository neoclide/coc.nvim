export declare class Range {
    start: number;
    end: number;
    constructor(start: number, end?: number);
    static fromKeywordOption(keywordOption: string): Range[];
    contains(c: number): boolean;
}
export declare class Chars {
    ranges: Range[];
    constructor(keywordOption: string);
    addKeyword(ch: string): void;
    setKeywordOption(keywordOption: string): void;
    matchKeywords(content: string, min?: number): string[];
    isKeywordChar(ch: string): boolean;
    isKeyword(word: string): boolean;
}
