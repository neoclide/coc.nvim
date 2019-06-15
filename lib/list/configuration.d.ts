export declare const validKeys: string[];
export default class ListConfiguration {
    private configuration;
    private disposable;
    constructor();
    get<T>(key: string, defaultValue?: T): T;
    readonly previousKey: string;
    readonly nextKey: string;
    dispose(): void;
    fixKey(key: string): string;
}
