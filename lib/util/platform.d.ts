export interface IProcessEnvironment {
    [key: string]: string;
}
export declare const language = "en";
export declare enum Platform {
    Web = 0,
    Mac = 1,
    Linux = 2,
    Windows = 3
}
export declare const isWindows: boolean;
export declare const isMacintosh: boolean;
export declare const isLinux: boolean;
export declare const isNative: boolean;
export declare const isWeb = false;
export declare const platform: Platform;
export declare const globals: any;
export declare const enum OperatingSystem {
    Windows = 1,
    Macintosh = 2,
    Linux = 3
}
export declare const OS: OperatingSystem;
