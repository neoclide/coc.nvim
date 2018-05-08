import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export default class Buffer extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
