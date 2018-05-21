import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../../types';
import ServiceSource from '../../model/source-service';
export default class Racer extends ServiceSource {
    private service;
    private disabled;
    constructor(nvim: Neovim);
    onInit(): Promise<void>;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
