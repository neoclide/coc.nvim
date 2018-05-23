/// <reference types="node" />
import EventEmitter = require('events');
export declare type Callback = (msg: string) => void;
/**
 * IpcService for commnucate with another nodejs process
 * @public
 *
 * @extends {EventEmitter}
 */
export default class IpcService extends EventEmitter {
    modulePath: string;
    cwd: string;
    execArgv: string[];
    args: string[];
    private cb;
    private child;
    private running;
    constructor(modulePath: string, cwd: string, execArgv: string[], args: string[]);
    readonly isRunnning: boolean;
    start(): void;
    request(data: {
        [index: string]: any;
    }): Promise<any>;
    stop(): void;
}
