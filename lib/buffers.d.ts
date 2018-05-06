import Buffer from './model/buffer';
export declare class Buffers {
    buffers: Buffer[];
    constructor();
    addBuffer(bufnr: string, content: string, keywordOption: string): void;
    removeBuffer(bufnr: string): void;
    getWords(bufnr: string): string[];
    getBuffer(bufnr: string): Buffer | null;
}
declare const buffers: Buffers;
export default buffers;
