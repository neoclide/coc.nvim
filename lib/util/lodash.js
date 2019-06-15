"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** Used for built-in method references. */
const objectProto = Object.prototype;
/** Used to check objects for own properties. */
const hasOwnProperty = objectProto.hasOwnProperty;
/**
 * Assigns own and inherited enumerable string keyed properties of source
 * objects to the destination object for all destination properties that
 * resolve to `undefined`. Source objects are applied from left to right.
 * Once a property is set, additional values of the same property are ignored.
 *
 * **Note:** This method mutates `object`.
 *
 * @since 0.1.0
 * @category Object
 * @param {Object} object The destination object.
 * @param {...Object} [sources] The source objects.
 * @returns {Object} Returns `object`.
 * @see defaultsDeep
 * @example
 *
 * defaults({ 'a': 1 }, { 'b': 2 }, { 'a': 3 })
 * // => { 'a': 1, 'b': 2 }
 */
function defaults(obj, ...sources) {
    obj = Object(obj);
    sources.forEach(source => {
        if (source != null) {
            source = Object(source);
            for (const key in source) { // tslint:disable-line
                const value = obj[key];
                if (value === undefined ||
                    (value === objectProto[key] && !hasOwnProperty.call(obj, key))) {
                    obj[key] = source[key];
                }
            }
        }
    });
    return obj;
}
exports.defaults = defaults;
function omit(obj, properties) {
    let o = {};
    for (let key of Object.keys(obj)) {
        if (properties.indexOf(key) == -1) {
            o[key] = obj[key];
        }
    }
    return o;
}
exports.omit = omit;
//# sourceMappingURL=lodash.js.map