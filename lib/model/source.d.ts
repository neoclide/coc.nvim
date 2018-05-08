import { Neovim } from 'neovim';
import { SourceOption, CompleteOption, CompleteResult } from '../types';
export default abstract class Source {
    readonly name: string;
    readonly shortcut?: string;
    readonly priority: number;
    readonly filetypes: string[] | null | undefined;
    readonly engross: boolean;
    readonly nvim: Neovim;
    constructor(nvim: Neovim, option: SourceOption);
    readonly menu: string;
    checkFileType(filetype: string): boolean;
    refresh(): Promise<void>;
    abstract shouldComplete(opt: CompleteOption): Promise<boolean>;
    abstract doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
