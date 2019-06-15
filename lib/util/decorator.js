"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('./logger')('util-decorator');
function memorize(_target, key, descriptor) {
    let fn = descriptor.get;
    if (typeof fn !== 'function')
        return;
    let memoKey = '$' + key;
    descriptor.get = function (...args) {
        if (this.hasOwnProperty(memoKey))
            return Promise.resolve(this[memoKey]);
        return new Promise((resolve, reject) => {
            Promise.resolve(fn.apply(this, args)).then(res => {
                this[memoKey] = res;
                resolve(res);
            }, e => {
                reject(e);
            });
        });
    };
}
exports.memorize = memorize;
//# sourceMappingURL=decorator.js.map