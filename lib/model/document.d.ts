import { TextDocument, TextEdit } from 'vscode-languageserver-types';
export default class Doc {
    doc: TextDocument;
    keywordsRegex: RegExp;
    content: string;
    constructor(uri: string, filetype: string, version: number, content: string, keywordRegStr: string);
    applyEdits(edits: TextEdit[]): string;
    getWords(): string[];
}
