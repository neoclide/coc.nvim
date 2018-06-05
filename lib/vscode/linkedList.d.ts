import { IIterator } from './iterator';
export declare class LinkedList<E> {
    private _first;
    private _last;
    isEmpty(): boolean;
    clear(): void;
    unshift(element: E): () => void;
    push(element: E): () => void;
    private insert;
    iterator(): IIterator<E>;
    toArray(): E[];
}
