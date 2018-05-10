import { Neovim } from 'neovim';
import VimSource from './model/source-vim';
export interface Remote {
    filepath: string;
    name: string;
    instance: VimSource | null;
}
export declare class Remotes {
    list: Remote[];
    constructor();
    readonly names: string[];
    readonly sources: VimSource[];
    has(name: string): boolean;
    private getFilepath(name);
    init(nvim: Neovim, nativeNames: string[], isCheck?: boolean): Promise<void>;
    private reportError(nvim, name, msg, fullpath?);
    private checkSource(nvim, name, fullpath, isCheck?);
    getOptionalFns(nvim: Neovim, name: string): Promise<string[]>;
    createSource(nvim: Neovim, name: string, isCheck?: boolean): Promise<VimSource | null>;
    getSource(nvim: Neovim, name: string): Promise<VimSource | null>;
}
declare const _default: Remotes;
export default _default;
