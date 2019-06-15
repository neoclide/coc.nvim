export default class CallSequence {
    private funcs;
    private _canceled;
    private _resolved;
    private promise;
    addFunction(fn: Function): void;
    start(): Promise<boolean>;
    ready(): Promise<any>;
    cancel(): Promise<any>;
}
