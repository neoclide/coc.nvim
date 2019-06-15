import { ConfigurationShape, ConfigurationTarget, IWorkspace } from '../types';
export default class ConfigurationProxy implements ConfigurationShape {
    private workspace;
    constructor(workspace: IWorkspace);
    private readonly nvim;
    private modifyConfiguration;
    $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void;
    $removeConfigurationOption(target: ConfigurationTarget, key: string): void;
}
