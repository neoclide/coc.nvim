export default class Mru {
    private name;
    private file;
    constructor(name: string, base?: string);
    load(): Promise<string[]>;
    add(item: string): Promise<void>;
    remove(item: string): Promise<void>;
    clean(): Promise<void>;
}
