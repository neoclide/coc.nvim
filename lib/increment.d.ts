import { Neovim } from 'neovim';
import { CompleteOption, VimCompleteItem } from './types';
import Input from './model/input';
export interface CompleteDone {
    word: string;
    timestamp: number;
    colnr: number;
    linenr: number;
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
    maxDoneCount: number;
    constructor(nvim: Neovim);
    stop(): Promise<void>;
    /**
     * start
     *
     * @public
     * @param {string} input - current user input
     * @param {string} word - the word before cursor
     * @returns {Promise<void>}
     */
    start(input: string, word: string, hasInsert: boolean): Promise<void>;
    setOption(opt: CompleteOption): void;
    onCompleteDone(item: VimCompleteItem | null, isCoc: boolean): Promise<boolean>;
    onCharInsert(): Promise<void>;
    private getNoinsertOption();
    onTextChangeI(): Promise<boolean>;
}
