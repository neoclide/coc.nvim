"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function intersect(array, other) {
    for (let item of other) {
        if (array.indexOf(item) !== -1) {
            return true;
        }
    }
    return false;
}
exports.intersect = intersect;
function tail(array, n = 0) {
    return array[array.length - (1 + n)];
}
exports.tail = tail;
function group(array, size) {
    let len = array.length;
    let res = [];
    for (let i = 0; i < Math.ceil(len / size); i++) {
        res.push(array.slice(i * size, (i + 1) * size));
    }
    return res;
}
exports.group = group;
/**
 * Removes duplicates from the given array. The optional keyFn allows to specify
 * how elements are checked for equalness by returning a unique string for each.
 */
function distinct(array, keyFn) {
    if (!keyFn) {
        return array.filter((element, position) => {
            return array.indexOf(element) === position;
        });
    }
    const seen = Object.create(null);
    return array.filter(elem => {
        const key = keyFn(elem);
        if (seen[key]) {
            return false;
        }
        seen[key] = true;
        return true;
    });
}
exports.distinct = distinct;
function lastIndex(array, fn) {
    let i = array.length - 1;
    while (i >= 0) {
        if (fn(array[i])) {
            break;
        }
        i--;
    }
    return i;
}
exports.lastIndex = lastIndex;
exports.flatMap = (xs, f) => xs.reduce((x, y) => [...x, ...f(y)], []);
//# sourceMappingURL=array.js.map