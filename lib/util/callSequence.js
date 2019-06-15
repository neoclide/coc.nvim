"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class CallSequence {
    constructor() {
        this.funcs = new Set();
        this._canceled = false;
        this._resolved = false;
    }
    addFunction(fn) {
        this.funcs.add(fn);
    }
    start() {
        this.promise = new Promise(async (resolve, reject) => {
            for (let fn of this.funcs) {
                if (this._canceled)
                    return resolve(true);
                try {
                    let cancel = await Promise.resolve(fn());
                    if (cancel === true) {
                        this._canceled = true;
                        return resolve(true);
                    }
                }
                catch (e) {
                    reject(e);
                }
            }
            this._resolved = true;
            resolve(false);
        });
        return this.promise;
    }
    ready() {
        return this.promise;
    }
    cancel() {
        if (this._resolved)
            return Promise.resolve(void 0);
        if (this._canceled)
            return this.promise;
        this._canceled = true;
        return this.promise;
    }
}
exports.default = CallSequence;
//# sourceMappingURL=callSequence.js.map