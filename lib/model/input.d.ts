import { Neovim } from 'neovim';
export default class Input {
    search: string;
    private linenr;
    private nvim;
    private startcol;
    private match?;
    constructor(nvim: Neovim, search: string, linenr: number, startcol: number);
    highlight(): Promise<void>;
    removeCharactor(): Promise<boolean>;
    addCharactor(c: string): Promise<void>;
    private getMatchPos;
    clear(): Promise<void>;
}
