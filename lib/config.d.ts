import { SourceConfig } from './types';
export declare function setConfig(opts: {
    [index: string]: any;
}): void;
export declare function getConfig(name: string): any;
export declare function configSource(name: string, opt: any): void;
export declare function getSourceConfig(name: string): Partial<SourceConfig>;
export declare function toggleSource(name: string): string;
export declare function shouldAutoComplete(): boolean;
