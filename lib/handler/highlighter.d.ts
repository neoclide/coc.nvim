import { Neovim } from '@chemzqm/neovim';
import { Color, ColorInformation, Disposable, Position, Range } from 'vscode-languageserver-protocol';
import Document from '../model/document';
export interface ColorRanges {
    color: Color;
    ranges: Range[];
}
export default class Highlighter implements Disposable {
    private nvim;
    private document;
    private srcId;
    winid: number;
    private matchIds;
    private _colors;
    private _version;
    constructor(nvim: Neovim, document: Document, srcId: any);
    readonly version: number;
    readonly bufnr: number;
    readonly colors: ColorInformation[];
    hasColor(): boolean;
    highlight(colors: ColorInformation[]): Promise<void>;
    private addHighlight;
    private addColors;
    clearHighlight(): void;
    private getColorRanges;
    hasColorAtPostion(position: Position): boolean;
    dispose(): void;
}
export declare function toHexString(color: Color): string;
