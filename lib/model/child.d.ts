/// <reference types="node" />
import EventEmitter = require('events');
export declare type Callback = (msg: string) => void;
export default class Child extends EventEmitter {
    command: string;
    args: string[];
    private cb;
    private cp;
    private running;
    private reader;
    private writer;
    constructor(command: string, args?: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(data: {
        [index: string]: any;
    }): Promise<string | null>;
    stop(): void;
}
