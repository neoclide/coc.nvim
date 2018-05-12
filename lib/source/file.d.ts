import { Neovim } from 'neovim';
import { CompleteOption, VimCompleteItem, CompleteResult } from '../types';
import Source from '../model/source';
export default class File extends Source {
    constructor(nvim: Neovim);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    private getFileItem(root, filename, ext, trimExt);
    filterFiles(files: string[]): string[];
    getItemsFromRoots(pathstr: string, roots: string[], ext: string): Promise<VimCompleteItem[]>;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
