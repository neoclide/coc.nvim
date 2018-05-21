/// <reference types="node" />
import EventEmitter = require('events');
import { RequestOptions } from 'http';
export declare type Callback = (msg: string) => void;
export default class HttpService extends EventEmitter {
    command: string;
    args: string[];
    private child;
    private running;
    constructor(command: string, args?: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(opt: RequestOptions): Promise<string>;
    stop(): void;
}
