export interface IIteratorResult<T> {
    readonly done: boolean;
    readonly value: T;
}
export interface IIterator<E> {
    next(): IIteratorResult<E>;
}
export interface INextIterator<T> {
    next(): T;
}
export interface INavigator<T> extends INextIterator<T> {
    current(): T;
    previous(): T;
    parent(): T;
    first(): T;
    last(): T;
    next(): T;
}
export declare class ArrayIterator<T> implements INextIterator<T> {
    private items;
    protected start: number;
    protected end: number;
    protected index: number;
    constructor(items: T[], start?: number, end?: number);
    first(): T;
    next(): T;
    protected current(): T;
}
export declare class ArrayNavigator<T> extends ArrayIterator<T> implements INavigator<T> {
    constructor(items: T[], start?: number, end?: number);
    current(): T;
    previous(): T;
    first(): T;
    last(): T;
    parent(): T;
}
export declare class MappedIterator<T, R> implements INextIterator<R> {
    protected iterator: INextIterator<T>;
    protected fn: (item: T) => R;
    constructor(iterator: INextIterator<T>, fn: (item: T) => R);
    next(): R;
}
export declare class MappedNavigator<T, R> extends MappedIterator<T, R> implements INavigator<R> {
    protected navigator: INavigator<T>;
    constructor(navigator: INavigator<T>, fn: (item: T) => R);
    current(): R;
    previous(): R;
    parent(): R;
    first(): R;
    last(): R;
    next(): R;
}
