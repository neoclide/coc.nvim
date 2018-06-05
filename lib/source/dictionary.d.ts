import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export default class Dictionary extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    getWords(files: string[]): Promise<string[]>;
    private getDictWords;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
