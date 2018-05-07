export default class Buffer {
    bufnr: string;
    content: string;
    keywordOption: string;
    words: string[];
    hash: string;
    private chars;
    constructor(bufnr: string, content: string, keywordOption: string);
    isWord(word: string): boolean;
    private generate();
    setKeywordOption(option: string): void;
    setContent(content: string): void;
}
