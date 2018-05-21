import { TextDocument } from 'vscode-languageserver-types';
import { Neovim } from 'neovim';
import { CompleteOption } from './types';
import Buffer from './model/buffer';
import Doc from './model/document';
export declare class Buffers {
    buffers: Buffer[];
    versions: {
        [index: string]: number;
    };
    document: Doc;
    constructor();
    private getVersion(uri);
    createDocument(nvim: Neovim, opt: CompleteOption): Promise<void>;
    getFileDocument(nvim: Neovim, filepath: string, filetype: string): Promise<TextDocument>;
    addBuffer(nvim: Neovim, bufnr: number): Promise<void>;
    loadBufferContent(nvim: Neovim, bufnr: number, timeout?: number): Promise<string | null>;
    removeBuffer(bufnr: number): void;
    getWords(bufnr: number): string[];
    getBuffer(bufnr: number): Buffer | null;
    refresh(nvim: Neovim): Promise<void>;
}
declare const buffers: Buffers;
export default buffers;
