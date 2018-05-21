/// <reference types="node" />
import fs = require('fs');
export declare type OnReadLine = (line: string) => void;
export declare function statAsync(filepath: string): Promise<fs.Stats | null>;
export declare function isGitIgnored(fullpath: string): Promise<boolean>;
export declare function findSourceDir(fullpath: string): string | null;
export declare function getParentDirs(fullpath: string): string[];
export declare function readFile(fullpath: string, encoding: string, timeout?: number): Promise<string>;
export declare function readFileByLine(fullpath: string, onLine: OnReadLine, limit?: number): Promise<void>;
export declare function createTmpFile(content: string): Promise<string>;
