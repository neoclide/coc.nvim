export declare function boolean(value: any): value is boolean;
export declare function string(value: any): value is string;
export declare function number(value: any): value is number;
export declare function array(array: any): array is any[];
export declare function func(value: any): value is Function;
export declare function objectLiteral(obj: any): obj is object;
export declare function emptyObject(obj: any): boolean;
export declare function typedArray<T>(value: any, check: (value: any) => boolean): value is T[];
