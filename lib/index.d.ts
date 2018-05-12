import { Neovim } from 'neovim';
import { SourceStat, CompleteOption } from './types';
export default class CompletePlugin {
    nvim: Neovim;
    private debouncedOnChange;
    constructor(nvim: Neovim);
    private handleError(err);
    onVimEnter(): Promise<void>;
    cocBufUnload(args: any[]): Promise<void>;
    cocBufChange(args: any[]): Promise<void>;
    cocStart(args: [CompleteOption]): Promise<void>;
    cocCharInsert(): Promise<void>;
    cocDone(): Promise<void>;
    cocLeave(): Promise<void>;
    cocTextChangeI(): Promise<void>;
    cocResult(args: any[]): Promise<void>;
    cocCheck(): Promise<string[] | null>;
    cocSourceStat(): Promise<SourceStat[]>;
    cocSourceConfig(args: any): Promise<void>;
    cocSourceToggle(args: any): Promise<string>;
    cocSourceRefresh(args: any): Promise<boolean>;
    private onBufferChange(bufnr);
    private initConfig();
}
