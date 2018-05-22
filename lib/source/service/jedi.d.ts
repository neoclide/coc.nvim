import { Neovim } from 'neovim';
import { QueryOption, CompleteOption, CompleteResult } from '../../types';
import ServiceSource from '../../model/source-service';
export default class Jedi extends ServiceSource {
    private service;
    private disabled;
    constructor(nvim: Neovim);
    onInit(): Promise<void>;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
    showDocuments(query: QueryOption): Promise<void>;
    jumpDefinition(query: QueryOption): Promise<void>;
    showSignature(query: QueryOption): Promise<void>;
}
