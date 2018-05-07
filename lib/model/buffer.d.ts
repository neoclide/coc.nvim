export default class Buffer {
    bufnr: string;
    content: string;
    keywordRegStr: string;
    words: string[];
    moreWords: string[];
    hash: string;
    keywordsRegex: RegExp;
    keywordRegex: RegExp;
    constructor(bufnr: string, content: string, keywordRegStr: string);
    isWord(word: string): boolean;
    private generateWords();
    private genHash(content);
    setContent(content: string): void;
}
