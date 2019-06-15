import { ListManager } from './manager';
export default class History {
    private manager;
    private db;
    private index;
    private loaded;
    private current;
    constructor(manager: ListManager);
    readonly curr: string | null;
    load(): Promise<void>;
    add(): void;
    previous(): void;
    next(): void;
}
