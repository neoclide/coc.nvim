import { Neovim } from 'neovim';
export default class Input {
    input: string;
    word: string;
    positions: number[];
    private linenr;
    private nvim;
    private startcol;
    private match?;
    constructor(nvim: Neovim, input: string, word: string, linenr: number, startcol: number);
    private caseEqual(a, b, icase);
    highlight(): Promise<void>;
    removeCharactor(): Promise<boolean>;
    addCharactor(c: string): Promise<void>;
    private getMatchPos();
    readonly isValid: boolean;
    clear(): Promise<void>;
}
