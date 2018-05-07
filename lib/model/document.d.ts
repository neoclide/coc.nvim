import { TextDocument, TextEdit } from 'vscode-languageserver-types';
export default class Doc {
    doc: TextDocument;
    content: string;
    uri: string;
    filetype: string;
    version: number;
    private chars;
    constructor(uri: string, filetype: string, version: number, content: string, keywordOption: string);
    applyEdits(edits: TextEdit[]): string;
    setContent(content: string): void;
    isWord(word: string): boolean;
    getWords(): string[];
}
