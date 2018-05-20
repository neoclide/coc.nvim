import { TextDocument, TextEdit } from 'vscode-languageserver-types';
export default class Doc {
    content: string;
    uri: string;
    filetype: string;
    version: number;
    doc: TextDocument;
    private chars;
    constructor(uri: string, filetype: string, version: number, content: string, keywordOption: string);
    applyEdits(edits: TextEdit[]): string;
    getOffset(lnum: number, col: number): number;
    isWord(word: string): boolean;
    getWords(): string[];
}
