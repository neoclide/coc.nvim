export default class Buffer {
    bufnr: number;
    content: string;
    keywordOption: string;
    words: string[];
    private chars;
    constructor(bufnr: number, content: string, keywordOption: string);
    isWord(word: string): boolean;
    private generate();
    setKeywordOption(option: string): void;
    setContent(content: string): void;
}
