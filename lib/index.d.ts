import { Neovim } from 'neovim';
import { SourceStat, CompleteOptionVim } from './types';
export default class CompletePlugin {
    nvim: Neovim;
    private debouncedOnChange;
    constructor(nvim: Neovim);
    onVimEnter(): Promise<void>;
    onBufUnload(args: any[]): Promise<void>;
    onBufChange(args: any[]): Promise<void>;
    completeStart(args: CompleteOptionVim[]): Promise<void>;
    completeCharInsert(): Promise<void>;
    completeDone(): Promise<void>;
    completeResume(args: CompleteOptionVim[]): Promise<void>;
    completeResult(args: any[]): Promise<void>;
    completeCheck(): Promise<string[] | null>;
    completeSourceStat(): Promise<SourceStat[]>;
    completeSourceToggle(args: any): Promise<void>;
    private onBufferChange(bufnr);
    private initConfig();
}
