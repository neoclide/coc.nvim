export default class DB {
    readonly filepath: string;
    constructor(filepath: string);
    fetch(key: string): Promise<any>;
    fetchSync(key: string): any;
    exists(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    push(key: string, data: number | null | boolean | string | {
        [index: string]: any;
    }): Promise<void>;
    private load;
    clear(): Promise<void>;
    destroy(): Promise<void>;
}
