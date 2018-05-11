import { Neovim } from 'neovim';
import { CompleteOption, VimCompleteItem, CompleteResult } from '../types';
import Source from '../model/source';
export default class Around extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    private getFileItem(root, filename);
    getItemsFromRoots(pathstr: string, roots: string[]): Promise<VimCompleteItem[]>;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
