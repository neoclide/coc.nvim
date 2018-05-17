export default class Doc {
    content: string;
    uri: string;
    filetype: string;
    version: number;
    private chars;
    constructor(uri: string, filetype: string, version: number, content: string, keywordOption: string);
    isWord(word: string): boolean;
    getWords(): string[];
}
