import { Neovim } from 'neovim';
export declare type Callback = (arg: string) => void;
export declare function contextDebounce(func: Callback, timeout: number): Callback;
export declare function wait(ms: number): Promise<void>;
export declare function echoErr(nvim: Neovim, line: string): Promise<void>;
export declare function echoWarning(nvim: Neovim, line: string): Promise<void>;
export declare function echoErrors(nvim: Neovim, lines: string[]): Promise<void>;
