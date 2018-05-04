import { Config } from './types';
export declare function setConfig(opts: Config): void;
export declare function getConfig<Config, K extends keyof Config>(name: K): Config[K];
