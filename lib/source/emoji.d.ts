import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export interface Item {
    description: string;
    character: string;
}
export default class Emoji extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
