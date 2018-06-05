/// <reference types="node" />
import * as stream from 'stream';
export interface ICallback<T> {
    (data: T): void;
}
export declare class Reader<T> {
    private readonly readable;
    private readonly callback;
    private readonly onError;
    private readonly buffer;
    private nextMessageLength;
    constructor(readable: stream.Readable, callback: ICallback<T>, onError: (error: any) => void);
    private onLengthData;
}
