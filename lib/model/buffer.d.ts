export default class Buffer {
    bufnr: string;
    content: string;
    words: string[];
    moreWords: string[];
    hash: string;
    constructor(bufnr: string, content: string);
    private generateWords();
    private genHash(content);
    setContent(content: string): void;
}
