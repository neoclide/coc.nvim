import { Neovim } from 'neovim';
export default class Input {
    input: string;
    word: string;
    positions: number[];
    private linenr;
    private nvim;
    private startcol;
    private match?;
    constructor(nvim: Neovim, linenr: any, input: string, word: string, startcol: number);
    removeCharactor(): Promise<boolean>;
    addCharactor(c: string): Promise<void>;
    private getMatchPos();
    clear(): Promise<void>;
}
