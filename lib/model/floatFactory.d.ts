import { Neovim } from '@chemzqm/neovim';
import { Disposable } from 'vscode-languageserver-protocol';
import { Documentation, Env } from '../types';
export interface WindowConfig {
    width: number;
    height: number;
    col: number;
    row: number;
    relative: 'cursor' | 'win' | 'editor';
}
export default class FloatFactory implements Disposable {
    private nvim;
    private env;
    private preferTop;
    private maxHeight;
    private maxWidth?;
    private targetBufnr;
    private window;
    private disposables;
    private floatBuffer;
    private tokenSource;
    private alignTop;
    private createTs;
    private cursor;
    private popup;
    constructor(nvim: Neovim, env: Env, preferTop?: boolean, maxHeight?: number, maxWidth?: number);
    private onCursorMoved;
    private checkFloatBuffer;
    private readonly columns;
    private readonly lines;
    getBoundings(docs: Documentation[], offsetX?: number): Promise<WindowConfig>;
    create(docs: Documentation[], allowSelection?: boolean, offsetX?: number): Promise<void>;
    createVim(docs: Documentation[], allowSelection?: boolean, offsetX?: number): Promise<void>;
    createNvim(docs: Documentation[], allowSelection?: boolean, offsetX?: number): Promise<void>;
    /**
     * Close float window
     */
    close(): void;
    private closeWindow;
    dispose(): void;
    private readonly buffer;
    activated(): Promise<boolean>;
}
