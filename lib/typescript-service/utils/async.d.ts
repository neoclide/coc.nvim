export declare type ITask<T> = () => T;
export declare class Delayer<T> {
    defaultDelay: number;
    private timeout;
    private completionPromise;
    private onSuccess;
    private task;
    constructor(defaultDelay: number);
    trigger(task: ITask<T>, delay?: number): Promise<T | null>;
    private cancelTimeout;
}
