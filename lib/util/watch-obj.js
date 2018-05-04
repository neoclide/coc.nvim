"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function watchObject(obj) {
    const callbackMap = {};
    const handler = {
        get(target, property, receiver) {
            try {
                return new Proxy(target[property], handler);
            }
            catch (err) {
                return Reflect.get(target, property, receiver);
            }
        },
        defineProperty(target, property, descriptor) {
            let fn = callbackMap[property];
            if (fn) {
                fn(descriptor.value);
                delete callbackMap[property];
            }
            return Reflect.defineProperty(target, property, descriptor);
        },
        deleteProperty(target, property) {
            return Reflect.deleteProperty(target, property);
        }
    };
    return {
        watched: new Proxy(obj, handler),
        addWatcher(key, cb) {
            callbackMap[key] = cb;
        }
    };
}
exports.default = watchObject;
//# sourceMappingURL=watch-obj.js.map