export declare class Range {
    start: number;
    end: number;
    constructor(start: number, end?: number);
    contains(c: number): boolean;
}
export declare class Chars {
    ranges: Range[];
    constructor(keywordOption: string);
    matchKeywords(content: string, min?: number): string[];
    isKeywordChar(ch: string): boolean;
    isKeyword(word: string): boolean;
}
