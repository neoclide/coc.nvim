import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export default class Dictionary extends Source {
    private dicts;
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    getWords(dicts: string[]): Promise<string[]>;
    private getDictWords(file);
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
