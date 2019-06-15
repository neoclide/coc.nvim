"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hasOwnProperty = Object.prototype.hasOwnProperty;
function boolean(value) {
    return typeof value === 'boolean';
}
exports.boolean = boolean;
function string(value) {
    return typeof value === 'string';
}
exports.string = string;
function number(value) {
    return typeof value === 'number';
}
exports.number = number;
function array(array) {
    return Array.isArray(array);
}
exports.array = array;
function func(value) {
    return typeof value == 'function';
}
exports.func = func;
function objectLiteral(obj) {
    return (obj != null &&
        typeof obj === 'object' &&
        !Array.isArray(obj) &&
        !(obj instanceof RegExp) &&
        !(obj instanceof Date));
}
exports.objectLiteral = objectLiteral;
function emptyObject(obj) {
    if (!objectLiteral(obj)) {
        return false;
    }
    for (let key in obj) {
        if (hasOwnProperty.call(obj, key)) {
            return false;
        }
    }
    return true;
}
exports.emptyObject = emptyObject;
function typedArray(value, check) {
    return Array.isArray(value) && value.every(check);
}
exports.typedArray = typedArray;
//# sourceMappingURL=is.js.map