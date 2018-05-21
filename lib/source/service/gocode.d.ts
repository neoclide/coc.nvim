import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../../types';
import ServiceSource from '../../model/source-service';
export default class Gocode extends ServiceSource {
    private disabled;
    constructor(nvim: Neovim);
    onInit(): Promise<void>;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
