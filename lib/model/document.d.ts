import { Buffer, Neovim } from '@chemzqm/neovim';
import { DidChangeTextDocumentParams, Event, Position, Range, TextDocument, TextEdit, CancellationToken } from 'vscode-languageserver-protocol';
import { Env } from '../types';
import { Chars } from './chars';
export declare type LastChangeType = 'insert' | 'change' | 'delete';
export default class Document {
    readonly buffer: Buffer;
    private env;
    paused: boolean;
    buftype: string;
    isIgnored: boolean;
    chars: Chars;
    textDocument: TextDocument;
    fireContentChanges: Function & {
        clear(): void;
    };
    fetchContent: Function & {
        clear(): void;
    };
    private colorId;
    private nvim;
    private eol;
    private attached;
    private variables;
    private lines;
    private _filetype;
    private _additionalKeywords;
    private _uri;
    private _rootPatterns;
    private _changedtick;
    private _words;
    private _onDocumentChange;
    private _onDocumentDetach;
    readonly onDocumentChange: Event<DidChangeTextDocumentParams>;
    readonly onDocumentDetach: Event<string>;
    constructor(buffer: Buffer, env: Env);
    readonly shouldAttach: boolean;
    readonly words: string[];
    setFiletype(filetype: string): void;
    convertFiletype(filetype: string): string;
    /**
     * Current changedtick of buffer
     *
     * @public
     * @returns {number}
     */
    readonly changedtick: number;
    readonly schema: string;
    readonly lineCount: number;
    init(nvim: Neovim, token: CancellationToken): Promise<boolean>;
    setIskeyword(iskeyword: string): void;
    attach(): Promise<boolean>;
    private onChange;
    /**
     * Make sure current document synced correctly
     *
     * @public
     * @returns {Promise<void>}
     */
    checkDocument(): Promise<void>;
    readonly dirty: boolean;
    private _fireContentChanges;
    detach(): void;
    readonly bufnr: number;
    readonly content: string;
    readonly filetype: string;
    readonly uri: string;
    readonly version: number;
    applyEdits(_nvim: Neovim, edits: TextEdit[], sync?: boolean): Promise<void>;
    forceSync(ignorePause?: boolean): void;
    getOffset(lnum: number, col: number): number;
    isWord(word: string): boolean;
    getMoreWords(): string[];
    /**
     * Current word for replacement
     */
    getWordRangeAtPosition(position: Position, extraChars?: string, current?: boolean): Range | null;
    private gitCheck;
    private createDocument;
    private _fetchContent;
    patchChange(): Promise<void>;
    getSymbolRanges(word: string): Range[];
    patchChangedTick(): Promise<void>;
    fixStartcol(position: Position, valids: string[]): number;
    matchAddRanges(ranges: Range[], hlGroup: string, priority?: number): number[];
    highlightRanges(ranges: Range[], hlGroup: string, srcId: number): number[];
    clearMatchIds(ids: Set<number> | number[]): void;
    getcwd(): Promise<string>;
    getLocalifyBonus(sp: Position, ep: Position): Map<string, number>;
    /**
     * Real current line
     */
    getline(line: number, current?: boolean): string;
    getDocumentContent(): string;
    getVar<T>(key: string, defaultValue?: T): T;
    readonly rootPatterns: string[] | null;
}
