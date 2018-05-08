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
    addBuffer(nvim: Neovim, bufnr: string): Promise<void>;
    removeBuffer(bufnr: string): void;
    getWords(bufnr: string): string[];
    getBuffer(bufnr: string): Buffer | null;
    refresh(nvim: Neovim): Promise<void>;
}
declare const buffers: Buffers;
export default buffers;
