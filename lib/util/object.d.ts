export declare function deepClone<T>(obj: T): T;
export declare function deepFreeze<T>(obj: T): T;
/**
 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
 * if existing properties on the destination should be overwritten or not. Defaults to true (overwrite).
 */
export declare function mixin(destination: any, source: any, overwrite?: boolean): any;
export declare function equals(one: any, other: any): boolean;
