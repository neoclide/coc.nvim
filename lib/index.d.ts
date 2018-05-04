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
    onBufferWrite(buf: string): Promise<void>;
    onBufUnload(args: any[]): Promise<void>;
    onBufAdd(args: any[]): Promise<void>;
    onBufChangeI(args: any[]): Promise<void>;
    completeStart(args: CompleteOptionVim[]): Promise<null>;
    completeResult(args: any[]): Promise<void>;
    private onBufferChange(bufnr);
    private initConfig();
}
