/// <reference types="node" />
import fs = require('fs');
export declare function statAsync(filepath: string): Promise<fs.Stats | null>;
export declare function isGitIgnored(fullpath: string): Promise<boolean>;
export declare function findSourceDir(fullpath: string): Promise<string | null>;
