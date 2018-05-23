import { VimCompleteItem } from '../types';
import { Neovim } from 'neovim';
export declare type Callback = (arg: number | string) => void;
export declare function escapeSingleQuote(str: string): string;
export declare function echoErr(nvim: Neovim, line: string): Promise<void>;
export declare function echoWarning(nvim: Neovim, line: string): Promise<void>;
export declare function echoErrors(nvim: Neovim, lines: string[]): Promise<void>;
export declare function getUserData(item: VimCompleteItem): {
    [index: string]: any;
} | null;
export declare function contextDebounce(func: Callback, timeout: number): Callback;
export declare function wait(ms: number): Promise<any>;
export declare function isCocItem(item: any): boolean;
export declare function filterWord(input: string, word: string, icase: boolean): boolean;
export declare function getPort(port?: number): Promise<number>;
export declare function toBool(s: number | string | boolean): boolean;
