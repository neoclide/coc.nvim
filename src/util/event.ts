import {
  Disposable,
} from 'vscode-languageserver-protocol'
import {LinkedList} from './linkedList'
const logger = require('./logger')('util-event')
const canceledName = 'Canceled'

/**
 * Checks if the given error is a promise in canceled state
 */
function isPromiseCanceledError(error: any): boolean {
  return error instanceof Error && error.name === canceledName && error.message === canceledName
}

function onUnexpectedError(e: any): undefined {
  // ignore errors from cancelled promises
  if (!isPromiseCanceledError(e)) {
    logger.error(e.stack)
  }
  return undefined
}

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
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable // tslint:disable-line
  }

export namespace Event {
  const _disposable = {dispose() {}} // tslint:disable-line
  export const None: Event<any> = ()=> {
    return _disposable
  }
}

type Listener = [Function, any] | Function // tslint:disable-line

export interface EmitterOptions {
  onFirstListenerAdd?: Function
  onFirstListenerDidAdd?: Function
  onListenerDidAdd?: Function
  onLastListenerRemove?: Function
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
export class Emitter<T> {
  private static readonly _noop = function() {} // tslint:disable-line

  private _event: Event<T>
  private _listeners: LinkedList<Listener>
  private _deliveryQueue: [Listener, T][]
  private _disposed: boolean

  constructor(private _options?: EmitterOptions) {}

  /**
   * For the public to allow to subscribe
   * to events from this Emitter
   */
  public get event(): Event<T> {
    if (!this._event) {
      this._event = (
        listener: (e: T) => any,
        thisArgs?: any,
        disposables?: Disposable[]
      ) => {
        if (!this._listeners) {
          this._listeners = new LinkedList()
        }

        const firstListener = this._listeners.isEmpty()

        if (
          firstListener &&
          this._options &&
          this._options.onFirstListenerAdd
        ) {
          this._options.onFirstListenerAdd(this)
        }

        const remove = this._listeners.push(
          !thisArgs ? listener : [listener, thisArgs]
        )

        if (
          firstListener &&
          this._options &&
          this._options.onFirstListenerDidAdd
        ) {
          this._options.onFirstListenerDidAdd(this)
        }

        if (this._options && this._options.onListenerDidAdd) {
          this._options.onListenerDidAdd(this, listener, thisArgs)
        }

        let result: Disposable
        result = {
          dispose: () => {
            result.dispose = Emitter._noop
            if (!this._disposed) {
              remove()
              if (
                this._options &&
                this._options.onLastListenerRemove &&
                this._listeners.isEmpty()
              ) {
                this._options.onLastListenerRemove(this)
              }
            }
          }
        }
        if (Array.isArray(disposables)) {
          disposables.push(result)
        }

        return result
      }
    }
    return this._event
  }

  /**
   * To be kept private to fire an event to
   * subscribers
   */
  fire(event?: T): any { // tslint:disable-line
    if (this._listeners) {
      // put all [listener,event]-pairs into delivery queue
      // then emit all event. an inner/nested event might be
      // the driver of this

      if (!this._deliveryQueue) {
        this._deliveryQueue = []
      }

      for (
        let iter = this._listeners.iterator(), e = iter.next();
        !e.done;
        e = iter.next()
      ) {
        this._deliveryQueue.push([e.value, event])
      }

      while (this._deliveryQueue.length > 0) {
        const [listener, event] = this._deliveryQueue.shift()
        try {
          if (typeof listener === 'function') {
            listener.call(undefined, event)
          } else {
            listener[0].call(listener[1], event)
          }
        } catch (e) {
          onUnexpectedError(e)
        }
      }
    }
  }

  public dispose():void {
    if (this._listeners) {
      this._listeners = undefined
    }
    if (this._deliveryQueue) {
      this._deliveryQueue.length = 0
    }
    this._disposed = true
  }
}
