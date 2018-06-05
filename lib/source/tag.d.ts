import { Neovim } from 'neovim';
import { CompleteOption, CompleteResult } from '../types';
import Source from '../model/source';
export interface CacheItem {
    mtime: Date;
    words: string[];
}
export default class Tag extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    private loadTags;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
