/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim';
import { CompleteOptionVim } from './types';
export default class CompletePlugin {
    nvim: Neovim;
    private debouncedOnChange;
    constructor(nvim: Neovim);
    onVimEnter(): Promise<void>;
    onBufUnload(args: any[]): Promise<void>;
    onBufChange(args: any[]): Promise<void>;
    completeStart(args: CompleteOptionVim[]): Promise<void>;
    completeResume(args: CompleteOptionVim[]): Promise<void>;
    completeResult(args: any[]): Promise<void>;
    completeCheck(): Promise<string[] | null>;
    private onBufferChange(bufnr);
    private initConfig();
}
