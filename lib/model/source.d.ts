import { Neovim } from 'neovim';
import { SourceOption, VimCompleteItem, CompleteOption, CompleteResult } from '../types';
export default abstract class Source {
    readonly name: string;
    shortcut?: string;
    filetypes: string[] | null | undefined;
    engross: boolean;
    priority: number;
    optionalFns: string[];
    [index: string]: any;
    protected readonly nvim: Neovim;
    constructor(nvim: Neovim, option: SourceOption);
    readonly menu: string;
    protected convertToItems(list: any[], extra?: any): VimCompleteItem[];
    checkFileType(filetype: string): boolean;
    refresh(): Promise<void>;
    abstract shouldComplete(opt: CompleteOption): Promise<boolean>;
    abstract doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
