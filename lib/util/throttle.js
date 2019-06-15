"use strict";
/**
 * Returns a new function that, when invoked, invokes `func` at most once per `wait` milliseconds.
 *
 * @param {Function} func Function to wrap.
 * @param {Number} wait Number of milliseconds that must elapse between `func` invocations.
 * @return {Function} A new function that wraps the `func` function passed in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
function throttle(func, wait) {
    let args;
    let rtn;
    let timeoutID;
    let last = 0;
    function fn() {
        args = arguments;
        let delta = Date.now() - last;
        if (!timeoutID) {
            if (last != 0 && delta >= wait) {
                call();
            }
            else {
                timeoutID = setTimeout(call, wait - delta);
            }
        }
        return rtn;
    }
    function call() {
        timeoutID = 0;
        last = Date.now();
        rtn = func.apply(null, args);
        args = null;
    }
    fn.clear = () => {
        if (timeoutID) {
            clearTimeout(timeoutID);
        }
    };
    return fn;
}
exports.default = throttle;
//# sourceMappingURL=throttle.js.map