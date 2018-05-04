/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim';
import VimSource from './model/source-vim';
export declare class Remotes {
    sourceMap: {
        [index: string]: VimSource;
    };
    initailized: boolean;
    private pathMap;
    constructor();
    private readonly names;
    has(name: any): boolean;
    init(nvim: Neovim): Promise<void>;
    checkFunctions(nvim: Neovim): Promise<string[]>;
    private createSource(nvim, name);
    getSource(nvim: Neovim, name: string): Promise<VimSource | null>;
}
declare const _default: Remotes;
export default _default;
