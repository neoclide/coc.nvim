import { ConfigurationModel } from './model';
import { IConfigurationData } from '../types';
export declare class Configuration {
    private _defaultConfiguration;
    private _userConfiguration;
    private _workspaceConfiguration;
    private _memoryConfiguration;
    private _consolidateConfiguration;
    constructor(_defaultConfiguration: ConfigurationModel, _userConfiguration: ConfigurationModel, _workspaceConfiguration: ConfigurationModel, _memoryConfiguration?: ConfigurationModel);
    private getConsolidateConfiguration;
    getValue(section?: string): any;
    inspect<C>(key: string): {
        default: C;
        user: C;
        workspace: C;
        memory?: C;
        value: C;
    };
    readonly defaults: ConfigurationModel;
    readonly user: ConfigurationModel;
    readonly workspace: ConfigurationModel;
    toData(): IConfigurationData;
}
