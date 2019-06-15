import { IConfigurationModel } from '../types';
export declare class ConfigurationModel implements IConfigurationModel {
    private _contents;
    constructor(_contents?: any);
    readonly contents: any;
    clone(): ConfigurationModel;
    getValue<V>(section: string): V;
    merge(...others: ConfigurationModel[]): ConfigurationModel;
    freeze(): ConfigurationModel;
    private mergeContents;
    setValue(key: string, value: any): void;
    removeValue(key: string): void;
}
