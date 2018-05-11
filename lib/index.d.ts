import { Neovim } from 'neovim';
import { SourceStat, CompleteOption } from './types';
export default class CompletePlugin {
    nvim: Neovim;
    private debouncedOnChange;
    constructor(nvim: Neovim);
    private handleError(err);
    onVimEnter(): Promise<void>;
    onBufUnload(args: any[]): Promise<void>;
    onBufChange(args: any[]): Promise<void>;
    completeStart(args: [CompleteOption]): Promise<void>;
    completeCharInsert(): Promise<void>;
    completeDone(): Promise<void>;
    completeLeave(): Promise<void>;
    completeTextChangeI(): Promise<void>;
    completeResume(): Promise<void>;
    completeResult(args: any[]): Promise<void>;
    completeCheck(): Promise<string[] | null>;
    completeSourceStat(): Promise<SourceStat[]>;
    completeSourceConfig(args: any): Promise<void>;
    completeSourceToggle(args: any): Promise<string>;
    completeSourceRefresh(args: any): Promise<boolean>;
    private onBufferChange(bufnr);
    private initConfig();
}
