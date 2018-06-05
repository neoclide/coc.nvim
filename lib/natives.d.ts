import { Neovim } from 'neovim';
import Source from './model/source';
import ServiceSource from './model/source-service';
export interface Native {
    Clz: typeof Source;
    filepath: string;
    name: string;
    instance: Source | ServiceSource | null;
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
    private createSource;
    getServiceSource(nvim: Neovim, filetype: string): Promise<ServiceSource | null>;
    getSource(nvim: Neovim, name: string): Promise<Source | null>;
}
declare const _default: Natives;
export default _default;
