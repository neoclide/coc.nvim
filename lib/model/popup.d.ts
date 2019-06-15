/**
 * popup interfact for vim
 */
import { TextItem, PopupOptions } from '../types';
import { Neovim } from '@chemzqm/neovim';
export declare class Popup {
    private nvim;
    id: number;
    bufferId: number;
    constructor(nvim: Neovim);
    create(text: string[] | TextItem[], options: PopupOptions): Promise<void>;
    hide(): void;
    valid(): Promise<boolean>;
    visible(): Promise<boolean>;
    show(): void;
    move(options: Partial<PopupOptions>): void;
    getPosition(): Promise<any>;
    setFiletype(filetype: string): void;
    dispose(): void;
}
export default function createPopup(nvim: Neovim, text: string[] | TextItem[], options: PopupOptions): Promise<Popup>;
