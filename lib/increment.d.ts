import { Neovim } from 'neovim';
import { CompleteOption } from './types';
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
    changedtick: number;
}
export declare class Increment {
    activted: boolean;
    input: Input | null | undefined;
    done: CompleteDone | null | undefined;
    lastInsert: InsertedChar | null | undefined;
    option: CompleteOption | null | undefined;
    changedI: ChangedI | null | undefined;
    constructor();
    isKeyword(ch: string): boolean;
    stop(nvim: Neovim): Promise<void>;
    start(nvim: Neovim): Promise<void>;
    setOption(opt: CompleteOption): void;
    private isCompleteItem(item);
    onComplete(nvim: Neovim): Promise<void>;
    onCharInsert(nvim: Neovim): Promise<void>;
    onTextChangeI(nvim: Neovim): Promise<boolean>;
}
declare const _default: Increment;
export default _default;
