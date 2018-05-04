import { Neovim } from 'neovim';
import { SourceOption, Filter, CompleteOption, CompleteResult } from '../types';
export default abstract class Source {
    readonly name: string;
    readonly shortcut?: string;
    readonly priority: number;
    readonly filetypes: string[];
    readonly engross: boolean;
    readonly filter?: Filter;
    readonly nvim: Neovim;
    protected readonly menu: string;
    constructor(nvim: Neovim, option: SourceOption);
    abstract shouldComplete(opt: CompleteOption): Promise<boolean>;
    abstract doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
