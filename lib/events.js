"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const util_1 = require("./util");
const workspace_1 = tslib_1.__importDefault(require("./workspace"));
const logger = require('./util/logger')('events');
class Events {
    constructor() {
        this.handlers = new Map();
        this.paused = false;
    }
    async fire(event, args) {
        if (this.paused && event == 'CursorHold')
            return;
        logger.debug('Event:', event, args);
        let handlers = this.handlers.get(event);
        if (handlers) {
            try {
                await Promise.all(handlers.map(fn => {
                    return Promise.resolve(fn.apply(null, args));
                }));
            }
            catch (e) {
                logger.error(`Error on ${event}: `, e.stack);
                workspace_1.default.showMessage(`Error on ${event}: ${e.message} `, 'error');
            }
        }
    }
    on(event, handler, thisArg, disposables) {
        if (Array.isArray(event)) {
            let disposables = [];
            for (let ev of event) {
                disposables.push(this.on(ev, handler, thisArg, disposables));
            }
            return vscode_languageserver_protocol_1.Disposable.create(() => {
                util_1.disposeAll(disposables);
            });
        }
        else {
            let arr = this.handlers.get(event) || [];
            arr.push(handler.bind(thisArg || null));
            this.handlers.set(event, arr);
            let disposable = vscode_languageserver_protocol_1.Disposable.create(() => {
                let idx = arr.indexOf(handler);
                if (idx !== -1) {
                    arr.splice(idx, 1);
                }
            });
            if (disposables) {
                disposables.push(disposable);
            }
            return disposable;
        }
    }
}
exports.default = new Events();
//# sourceMappingURL=events.js.map