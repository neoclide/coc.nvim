/// <reference types="node" />
import { Buffer, Neovim, Window } from '@chemzqm/neovim';
import * as cp from 'child_process';
import Emitter from 'events';
import Document from '../model/document';
import Plugin from '../plugin';
import { VimCompleteItem } from '../types';
export interface CursorPosition {
    bufnum: number;
    lnum: number;
    col: number;
}
export declare class Helper extends Emitter {
    nvim: Neovim;
    proc: cp.ChildProcess;
    plugin: Plugin;
    constructor();
    setup(): Promise<void>;
    shutdown(): Promise<void>;
    waitPopup(): Promise<void>;
    waitFloat(): Promise<number>;
    reset(): Promise<void>;
    pumvisible(): Promise<boolean>;
    wait(ms?: number): Promise<void>;
    visible(word: string, source?: string): Promise<boolean>;
    notVisible(word: string): Promise<boolean>;
    getItems(): Promise<VimCompleteItem[]>;
    edit(file?: string): Promise<Buffer>;
    createDocument(name?: string): Promise<Document>;
    getCmdline(): Promise<string>;
    updateConfiguration(key: string, value: any): void;
    mockFunction(name: string, result: string | number | any): Promise<void>;
    items(): Promise<VimCompleteItem[]>;
    screenLine(line: number): Promise<string>;
    getFloat(): Promise<Window>;
}
export declare function createTmpFile(content: string): Promise<string>;
declare const _default: Helper;
export default _default;
