import { Neovim } from 'neovim';
export declare function wait(ms: number): Promise<void>;
export declare function echoErr(nvim: Neovim, line: string): Promise<void>;
export declare function echoErrors(nvim: Neovim, lines: string[]): void;
