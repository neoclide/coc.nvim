import { Neovim } from 'neovim';
import Source from './model/source';
export interface Native {
    Clz: typeof Source;
    filepath: string;
    name: string;
    instance: Source | null;
    service: boolean;
}
export declare class Natives {
    list: Native[];
    constructor();
    readonly sources: Source[];
    init(): Promise<void>;
    has(name: any): boolean;
    getSourceNamesOfFiletype(filetype: string): string[];
    readonly names: string[];
    private createSource(nvim, name);
    getSource(nvim: Neovim, name: string): Promise<Source | null>;
}
declare const _default: Natives;
export default _default;
