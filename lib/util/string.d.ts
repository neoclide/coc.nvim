export declare function byteLength(str: string): number;
export declare function upperFirst(str: string): string;
export declare function byteIndex(content: string, index: number): number;
export declare function indexOf(str: string, ch: string, count?: number): number;
export declare function characterIndex(content: string, byteIndex: number): number;
export declare function byteSlice(content: string, start: number, end?: number): string;
export declare function isWord(character: string): boolean;
export declare function isTriggerCharacter(character: string): boolean;
export declare function resolveVariables(str: string, variables: {
    [key: string]: string;
}): string;
export declare function isAsciiLetter(code: number): boolean;
export declare function equalsIgnoreCase(a: string, b: string): boolean;
