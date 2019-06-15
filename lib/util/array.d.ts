export declare function intersect<T>(array: T[], other: T[]): boolean;
export declare function tail<T>(array: T[], n?: number): T;
export declare function group<T>(array: T[], size: number): T[][];
/**
 * Removes duplicates from the given array. The optional keyFn allows to specify
 * how elements are checked for equalness by returning a unique string for each.
 */
export declare function distinct<T>(array: T[], keyFn?: (t: T) => string): T[];
export declare function lastIndex<T>(array: T[], fn: (t: T) => boolean): number;
export declare const flatMap: <T, U>(xs: T[], f: (item: T) => U[]) => U[];
