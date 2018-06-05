import { Disposable } from 'vscode-languageserver-protocol';
/**
 * Represents a typed event.
 *
 * A function that represents an event to which you subscribe by calling it with
 * a listener function as argument.
 *
 * @sample `item.onDidChange(function(event) { console.log("Event happened: " + event); });`
 */
export interface Event<T> {
    /**
     * A function that represents an event to which you subscribe by calling it with
     * a listener function as argument.
     *
     * @param listener The listener function will be called when the event happens.
     * @param thisArgs The `this`-argument which will be used when calling the event listener.
     * @param disposables An array to which a [disposable](#Disposable) will be added.
     * @return A disposable which unsubscribes the event listener.
     */
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}
export declare namespace Event {
    const None: Event<any>;
}
export interface EmitterOptions {
    onFirstListenerAdd?: Function;
    onFirstListenerDidAdd?: Function;
    onListenerDidAdd?: Function;
    onLastListenerRemove?: Function;
}
/**
 * The Emitter can be used to expose an Event to the public
 * to fire it from the insides.
 * Sample:
 *   class Document {
 *     private _onDidChange = new Emitter<(value:string)=>any>();
 *     public onDidChange = this._onDidChange.event;
 *     // getter-style
 *     // get onDidChange(): Event<(value:string)=>any> {
 *     //   return this._onDidChange.event;
 *     // }
 *     private _doIt() {
 *     //...
 *     this._onDidChange.fire(value);
 *     }
 *   }
 */
export declare class Emitter<T> {
    private _options?;
    private static readonly _noop;
    private _event;
    private _listeners;
    private _deliveryQueue;
    private _disposed;
    constructor(_options?: EmitterOptions);
    /**
     * For the public to allow to subscribe
     * to events from this Emitter
     */
    readonly event: Event<T>;
    /**
     * To be kept private to fire an event to
     * subscribers
     */
    fire(event?: T): any;
    dispose(): void;
}
