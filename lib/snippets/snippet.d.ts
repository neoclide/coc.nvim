import { Position, Range, TextEdit } from 'vscode-languageserver-protocol';
import { VariableResolver } from './parser';
export interface CocSnippetPlaceholder {
    index: number;
    id: number;
    line: number;
    range: Range;
    value: string;
    isFinalTabstop: boolean;
    transform: boolean;
    choice?: string[];
    snippet: CocSnippet;
}
export declare class CocSnippet {
    private _snippetString;
    private position;
    private _variableResolver?;
    private _parser;
    private _placeholders;
    private tmSnippet;
    constructor(_snippetString: string, position: Position, _variableResolver?: VariableResolver);
    adjustPosition(characterCount: number, lineCount: number): void;
    adjustTextEdit(edit: TextEdit): boolean;
    readonly isPlainText: boolean;
    toString(): string;
    readonly range: Range;
    readonly firstPlaceholder: CocSnippetPlaceholder | null;
    readonly lastPlaceholder: CocSnippetPlaceholder;
    getPlaceholderById(id: number): CocSnippetPlaceholder;
    getPlaceholder(index: number): CocSnippetPlaceholder;
    getPrevPlaceholder(index: number): CocSnippetPlaceholder;
    getNextPlaceholder(index: number): CocSnippetPlaceholder;
    readonly finalPlaceholder: CocSnippetPlaceholder;
    getPlaceholderByRange(range: Range): CocSnippetPlaceholder;
    insertSnippet(placeholder: CocSnippetPlaceholder, snippet: string, range: Range): number;
    updatePlaceholder(placeholder: CocSnippetPlaceholder, edit: TextEdit): {
        edits: TextEdit[];
        delta: number;
    };
    private update;
}
