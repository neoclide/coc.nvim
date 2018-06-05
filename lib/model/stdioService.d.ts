/// <reference types="node" />
import EventEmitter = require('events');
export declare type Callback = (msg: string) => void;
export default class StdioService extends EventEmitter {
    command: string;
    args?: string[];
    private child;
    private running;
    constructor(command: string, args?: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(data: string): Promise<string | null>;
    stop(): void;
}
