import { Neovim } from 'neovim';
import Buffer from './model/buffer';
import Doc from './model/document';
export declare class Buffers {
    buffers: Buffer[];
    versions: {
        [index: string]: number;
    };
    document: Doc;
    constructor();
    createDocument(uri: string, filetype: string, content: string, keywordOption: string): Doc;
    addBuffer(nvim: Neovim, bufnr: number): Promise<void>;
    loadBufferContent(nvim: Neovim, bufnr: number, timeout?: number): Promise<string>;
    removeBuffer(bufnr: number): void;
    getWords(bufnr: number): string[];
    getBuffer(bufnr: number): Buffer | null;
    refresh(nvim: Neovim): Promise<void>;
}
declare const buffers: Buffers;
export default buffers;
