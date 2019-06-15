import { ParseError } from 'jsonc-parser';
import { IConfigurationModel, ErrorItem } from '../types';
export declare type ShowError = (errors: ErrorItem[]) => void;
export declare function parseContentFromFile(filepath: string | null, onError?: ShowError): IConfigurationModel;
export declare function parseConfiguration(content: string): [ParseError[], any];
export declare function convertErrors(uri: string, content: string, errors: ParseError[]): ErrorItem[];
export declare function addToValueTree(settingsTreeRoot: any, key: string, value: any, conflictReporter: (message: string) => void): void;
export declare function removeFromValueTree(valueTree: any, key: string): void;
export declare function getConfigurationValue<T>(config: any, settingPath: string, defaultValue?: T): T;
export declare function loadDefaultConfigurations(): IConfigurationModel;
export declare function getKeys(obj: {
    [key: string]: any;
}, curr?: string): string[];
export declare function getChangedKeys(from: {
    [key: string]: any;
}, to: {
    [key: string]: any;
}): string[];
