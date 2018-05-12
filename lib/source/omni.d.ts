import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export default class OmniSource extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
