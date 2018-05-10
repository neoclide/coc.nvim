import { Neovim } from 'neovim';
import Source from './model/source';
import Complete from './model/complete';
import { CompleteOption, VimCompleteItem } from './types';
export declare class Completes {
    complete: Complete | null;
    firstItem: VimCompleteItem | null;
    constructor();
    newComplete(opts: CompleteOption): Complete;
    createComplete(opts: CompleteOption): Complete;
    getSources(nvim: Neovim, filetype: string): Promise<Source[]>;
    reset(): void;
}
declare const _default: Completes;
export default _default;
