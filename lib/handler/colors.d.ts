import { Neovim } from '@chemzqm/neovim';
import { Position } from 'vscode-languageserver-protocol';
import Document from '../model/document';
export default class Colors {
    private nvim;
    private _enabled;
    private srcId;
    private disposables;
    private highlighters;
    private highlightCurrent;
    constructor(nvim: Neovim);
    private _highlightCurrent;
    highlightColors(document: Document, force?: boolean): Promise<void>;
    pickPresentation(): Promise<void>;
    pickColor(): Promise<void>;
    readonly enabled: boolean;
    clearHighlight(bufnr: number): void;
    hasColor(bufnr: number): boolean;
    hasColorAtPostion(bufnr: number, position: Position): boolean;
    dispose(): void;
    private getHighlighter;
    private currentColorInfomation;
}
