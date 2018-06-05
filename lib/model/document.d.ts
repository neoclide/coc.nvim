import { TextDocument, TextEdit } from 'vscode-languageserver-types';
import { Chars } from './chars';
export default class Document {
    textDocument: TextDocument;
    keywordOption: string;
    words: string[];
    isIgnored: boolean;
    chars: Chars;
    constructor(textDocument: TextDocument, keywordOption: string);
    private readonly includeDash;
    private gitCheck;
    readonly content: string;
    readonly filetype: string;
    readonly uri: string;
    readonly version: number;
    equalTo(doc: TextDocument): boolean;
    setKeywordOption(option: string): void;
    applyEdits(edits: TextEdit[]): string;
    getOffset(lnum: number, col: number): number;
    isWord(word: string): boolean;
    changeDocument(doc: TextDocument): void;
    getMoreWords(): string[];
    private generate;
}
