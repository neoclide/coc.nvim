import { Neovim } from 'neovim';
import Source from './model/source';
import Complete from './model/complete';
import { CompleteOptionVim } from './types';
export declare class Completes {
    completes: Complete[];
    constructor();
    createComplete(opts: CompleteOptionVim): Complete;
    getSources(nvim: Neovim, filetype: string): Promise<Source[]>;
    reset(): void;
}
declare const _default: Completes;
export default _default;
