/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim';
import Source from './model/source';
export interface Native {
    Clz: typeof Source;
    filepath: string;
    name: string;
    instance: Source | null;
}
export declare class Natives {
    list: Native[];
    constructor();
    readonly sources: Source[];
    init(): Promise<void>;
    has(name: any): boolean;
    readonly names: string[];
    private createSource(nvim, name);
    getSource(nvim: Neovim, name: string): Promise<Source | null>;
}
declare const _default: Natives;
export default _default;
