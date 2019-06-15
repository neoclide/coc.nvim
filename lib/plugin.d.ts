/// <reference types="node" />
import { NeovimClient as Neovim } from '@chemzqm/neovim';
import { EventEmitter } from 'events';
export default class Plugin extends EventEmitter {
    nvim: Neovim;
    private _ready;
    private handler;
    private infoChannel;
    constructor(nvim: Neovim);
    private addMethod;
    addCommand(cmd: {
        id: string;
        cmd: string;
        title?: string;
    }): void;
    init(): Promise<void>;
    readonly isReady: boolean;
    readonly ready: Promise<void>;
    findLocations(id: string, method: string, params: any, openCommand?: string | false): Promise<void>;
    snippetCheck(checkExpand: boolean, checkJump: boolean): Promise<boolean>;
    readonly version: string;
    showInfo(): Promise<void>;
    updateExtension(): Promise<void>;
    cocAction(...args: any[]): Promise<any>;
    dispose(): Promise<void>;
}
