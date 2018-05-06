export default class Buffer {
    bufnr: string;
    content: string;
    keywordRe: RegExp;
    words: string[];
    moreWords: string[];
    hash: string;
    constructor(bufnr: string, content: string, keywordRe: RegExp);
    private generateWords();
    private genHash(content);
    setContent(content: string): void;
}
