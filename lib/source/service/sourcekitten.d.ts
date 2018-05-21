import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../../types';
import Source from '../../model/source';
export default class SourceKitten extends Source {
    private disabled;
    private service;
    private port;
    private root;
    constructor(nvim: Neovim);
    onInit(): Promise<void>;
    private findProjectRoot(filepath);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
