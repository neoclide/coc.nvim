import { Neovim } from 'neovim';
import { CompleteOption, VimCompleteItem } from './types';
import Input from './input';
export interface CompleteDone {
    word: string;
    timestamp: number;
    colnr: number;
    linenr: number;
    changedtick: number;
}
export interface InsertedChar {
    character: string;
    timestamp: number;
}
export interface ChangedI {
    linenr: number;
    colnr: number;
}
export default class Increment {
    private nvim;
    activted: boolean;
    input: Input | null | undefined;
    done: CompleteDone | null | undefined;
    lastInsert: InsertedChar | null | undefined;
    option: CompleteOption | null | undefined;
    changedI: ChangedI | null | undefined;
    constructor(nvim: Neovim);
    isKeyword(str: string): boolean;
    stop(): Promise<void>;
    /**
     * start
     *
     * @public
     * @param {string} input - current user input
     * @param {string} word - the word before cursor
     * @returns {Promise<void>}
     */
    start(input: string, word: string): Promise<void>;
    setOption(opt: CompleteOption): void;
    private isCompleteItem(item);
    onCompleteDone(): Promise<VimCompleteItem | null>;
    onCharInsert(): Promise<void>;
    private getNoinsertOption();
    onTextChangeI(): Promise<boolean>;
}
