import { Neovim } from 'neovim';
import Source from './model/source';
import Complete from './model/complete';
import { CompleteOptionVim } from './types';
export declare class Completes {
    complete: Complete | null;
    constructor();
    newComplete(opts: CompleteOptionVim): Complete;
    createComplete(opts: CompleteOptionVim): Complete;
    getComplete(opts: CompleteOptionVim): Complete | null;
    getSources(nvim: Neovim, filetype: string): Promise<Source[]>;
}
declare const _default: Completes;
export default _default;
