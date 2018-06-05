import { Neovim } from 'neovim';
import { SourceOption, SourceConfig, VimCompleteItem, CompleteOption, FilterType, CompleteResult } from '../types';
export default abstract class Source {
    readonly name: string;
    readonly config: SourceConfig;
    protected readonly optionalFns: string[];
    protected readonly nvim: Neovim;
    constructor(nvim: Neovim, option: SourceOption);
    readonly priority: number;
    readonly filter: FilterType;
    readonly firstMatch: boolean;
    readonly isOnly: boolean;
    readonly engross: boolean;
    readonly filetypes: string[] | null;
    readonly menu: string;
    protected convertToItems(list: any[], extra?: any): VimCompleteItem[];
    protected filterWords(words: string[], opt: CompleteOption): string[];
    /**
     * fix start column for new valid characters
     *
     * @protected
     * @param {CompleteOption} opt
     * @param {string[]} valids - valid charscters
     * @returns {number}
     */
    protected fixStartcol(opt: CompleteOption, valids: string[]): number;
    checkFileType(filetype: string): boolean;
    refresh(): Promise<void>;
    onCompleteDone(item: VimCompleteItem): Promise<void>;
    abstract shouldComplete(opt: CompleteOption): Promise<boolean>;
    abstract doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
