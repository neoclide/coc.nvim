import { TypeScriptServiceConfiguration } from './configuration';
import API from './api';
export declare class TypeScriptVersion {
    readonly path: string;
    private readonly _pathLabel?;
    private _api;
    constructor(path: string, _pathLabel?: string);
    readonly tsServerPath: string;
    readonly pathLabel: string;
    readonly isValid: boolean;
    readonly version: API | null;
    readonly versionString: string | null;
    private getTypeScriptVersion;
}
export declare class TypeScriptVersionProvider {
    private configuration;
    constructor(configuration: TypeScriptServiceConfiguration);
    updateConfiguration(configuration: TypeScriptServiceConfiguration): void;
    readonly defaultVersion: TypeScriptVersion;
    readonly globalVersion: TypeScriptVersion | undefined;
    getLocalVersion(root: any): TypeScriptVersion | undefined;
    readonly bundledVersion: TypeScriptVersion | null;
}
