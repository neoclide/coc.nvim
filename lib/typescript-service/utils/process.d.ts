/// <reference types="node" />
import cp = require('child_process');
export interface IForkOptions {
    cwd?: string;
    execArgv?: string[];
}
export declare function makeRandomHexString(length: number): string;
export declare function getTempFile(name: string): string;
export declare function fork(modulePath: string, args: string[], options: IForkOptions, callback: (error: any, cp: cp.ChildProcess | null) => void): void;
