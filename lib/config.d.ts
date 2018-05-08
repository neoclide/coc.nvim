import { SourceConfig } from './types';
export declare function setConfig(opts: {
    [index: string]: any;
}): void;
export declare function getConfig(name: string): any;
export declare function configSource(name: string, opt: any): void;
export declare function getSourceConfig(name: string): SourceConfig | null;
export declare function toggleSource(name: string): void;
