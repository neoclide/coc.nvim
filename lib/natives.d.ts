/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim';
import Source from './model/source';
export declare class Natives {
    sourceMap: {
        [index: string]: Source;
    };
    classMap: {
        [index: string]: typeof Source;
    };
    names: string[];
    constructor();
    has(name: any): boolean;
    private createSource(nvim, name);
    getSource(nvim: Neovim, name: string): Promise<Source | null>;
}
declare const _default: Natives;
export default _default;
