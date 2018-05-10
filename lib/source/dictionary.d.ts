import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export default class Dictionary extends Source {
    private dicts;
    private dictOption;
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    getWords(files: string[]): Promise<string[]>;
    private getDictWords(file);
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
