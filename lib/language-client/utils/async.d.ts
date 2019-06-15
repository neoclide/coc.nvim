import { Disposable } from 'vscode-languageserver-protocol';
export interface Task<T> {
    (): T;
}
/**
 * A helper to delay execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * 		const delayer = new Delayer(WAITING_PERIOD)
 * 		const letters = []
 *
 * 		function letterReceived(l) {
 * 			letters.push(l)
 * 			delayer.trigger(() => { return makeTheTrip(); })
 * 		}
 */
export declare class Delayer<T> implements Disposable {
    defaultDelay: number;
    private timeout;
    private completionPromise;
    private doResolve;
    private doReject;
    private task;
    constructor(defaultDelay: number);
    trigger(task: Task<T | Thenable<T>>, delay?: number): Thenable<T>;
    isTriggered(): boolean;
    cancel(): void;
    private cancelTimeout;
    dispose(): void;
}
