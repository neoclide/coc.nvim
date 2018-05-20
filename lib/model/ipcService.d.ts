/// <reference types="node" />
import EventEmitter = require('events');
import { VimCompleteItem } from '../types';
export declare type Callback = (msg: string) => void;
export default class IpcService extends EventEmitter {
    modulePath: string;
    cwd: string;
    args: string[];
    private cb;
    private child;
    private running;
    constructor(modulePath: string, cwd: string, args?: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(data: {
        [index: string]: any;
    }): Promise<VimCompleteItem[]>;
    stop(): void;
}
