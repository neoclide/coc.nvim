import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../../types';
import Source from '../../model/source';
export default class Gocode extends Source {
    private disabled;
    constructor(nvim: Neovim);
    onInit(): Promise<void>;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
