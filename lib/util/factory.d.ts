/// <reference types="node" />
import { ExtensionContext } from '../types';
export interface ExtensionExport {
    activate: (context: ExtensionContext) => any;
    deactivate: () => any | null;
}
export interface IModule {
    new (name: string): any;
    _resolveFilename: (file: string, context: any) => string;
    _extensions: {};
    _cache: {
        [file: string]: any;
    };
    _compile: () => void;
    wrap: (content: string) => string;
    require: (file: string) => NodeModule;
    _nodeModulePaths: (filename: string) => string[];
}
export interface ISandbox {
    process: NodeJS.Process;
    module: NodeModule;
    require: (p: string) => any;
    console: {
        [key in keyof Console]?: Function;
    };
    Buffer: any;
    Reflect: any;
    String: any;
    Promise: any;
}
export declare function createExtension(id: string, filename: string): ExtensionExport;
