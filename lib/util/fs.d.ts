/// <reference types="node" />
import fs = require('fs');
export declare function statAsync(filepath: string): Promise<fs.Stats | null>;
