/// <reference types="node" />
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;
export declare function terminate(process: ChildProcess, cwd?: string): boolean;
