"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const linkedList_1 = require("./linkedList");
const errors_1 = require("./errors");
var Event;
(function (Event) {
    const _disposable = { dispose() { } }; // tslint:disable-line
    Event.None = () => {
        return _disposable;
    };
})(Event = exports.Event || (exports.Event = {}));
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
class Emitter {
    constructor(_options) {
        this._options = _options;
    }
    /**
     * For the public to allow to subscribe
     * to events from this Emitter
     */
    get event() {
        if (!this._event) {
            this._event = (listener, thisArgs, disposables) => {
                if (!this._listeners) {
                    this._listeners = new linkedList_1.LinkedList();
                }
                const firstListener = this._listeners.isEmpty();
                if (firstListener &&
                    this._options &&
                    this._options.onFirstListenerAdd) {
                    this._options.onFirstListenerAdd(this);
                }
                const remove = this._listeners.push(!thisArgs ? listener : [listener, thisArgs]);
                if (firstListener &&
                    this._options &&
                    this._options.onFirstListenerDidAdd) {
                    this._options.onFirstListenerDidAdd(this);
                }
                if (this._options && this._options.onListenerDidAdd) {
                    this._options.onListenerDidAdd(this, listener, thisArgs);
                }
                let result;
                result = {
                    dispose: () => {
                        result.dispose = Emitter._noop;
                        if (!this._disposed) {
                            remove();
                            if (this._options &&
                                this._options.onLastListenerRemove &&
                                this._listeners.isEmpty()) {
                                this._options.onLastListenerRemove(this);
                            }
                        }
                    }
                };
                if (Array.isArray(disposables)) {
                    disposables.push(result);
                }
                return result;
            };
        }
        return this._event;
    }
    /**
     * To be kept private to fire an event to
     * subscribers
     */
    fire(event) {
        if (this._listeners) {
            // put all [listener,event]-pairs into delivery queue
            // then emit all event. an inner/nested event might be
            // the driver of this
            if (!this._deliveryQueue) {
                this._deliveryQueue = [];
            }
            for (let iter = this._listeners.iterator(), e = iter.next(); !e.done; e = iter.next()) {
                this._deliveryQueue.push([e.value, event]);
            }
            while (this._deliveryQueue.length > 0) {
                const [listener, event] = this._deliveryQueue.shift();
                try {
                    if (typeof listener === 'function') {
                        listener.call(undefined, event);
                    }
                    else {
                        listener[0].call(listener[1], event);
                    }
                }
                catch (e) {
                    errors_1.onUnexpectedError(e);
                }
            }
        }
    }
    dispose() {
        if (this._listeners) {
            this._listeners = undefined;
        }
        if (this._deliveryQueue) {
            this._deliveryQueue.length = 0;
        }
        this._disposed = true;
    }
}
Emitter._noop = function () { }; // tslint:disable-line
exports.Emitter = Emitter;
//# sourceMappingURL=event.js.map