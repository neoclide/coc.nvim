import { Neovim } from 'neovim';
import { SourceStat, CompleteOption } from './types';
import Increment from './increment';
export default class CompletePlugin {
    nvim: Neovim;
    increment: Increment;
    private debouncedOnChange;
    constructor(nvim: Neovim);
    private handleError(err);
    cocInitAsync(): Promise<void>;
    cocInitSync(): Promise<void>;
    private onInit();
    cocBufUnload(args: any[]): Promise<void>;
    cocBufChange(args: any[]): Promise<void>;
    cocStart(args: [CompleteOption]): Promise<void>;
    cocCharInsert(): Promise<void>;
    cocCompleteDone(): Promise<void>;
    cocInsertLeave(): Promise<void>;
    cocTextChangeI(): Promise<void>;
    cocResult(args: any[]): Promise<void>;
    cocCheck(): Promise<string[] | null>;
    cocSourceStat(): Promise<SourceStat[]>;
    cocSourceToggle(args: any): Promise<string>;
    cocSourceRefresh(args: any): Promise<boolean>;
    private onBufferChange(bufnr);
    private initConfig();
}
