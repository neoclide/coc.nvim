export declare enum TsServerLogLevel {
    Off = 0,
    Normal = 1,
    Terse = 2,
    Verbose = 3
}
export declare namespace TsServerLogLevel {
    function fromString(value: string): TsServerLogLevel;
    function toString(value: TsServerLogLevel): string;
}
export declare class TypeScriptServiceConfiguration {
    readonly locale: string | null;
    readonly globalTsdk: string | null;
    readonly npmLocation: string | null;
    readonly tsServerLogLevel: TsServerLogLevel;
    readonly checkJs: boolean;
    readonly experimentalDecorators: boolean;
    readonly disableAutomaticTypeAcquisition: boolean;
    readonly tsServerPluginNames: string[];
    readonly tsServerPluginRoot: string | null;
    private constructor();
    static loadFromWorkspace(): TypeScriptServiceConfiguration;
}
