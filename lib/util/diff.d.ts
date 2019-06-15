import { ChangedLines } from '../types';
interface Change {
    start: number;
    end: number;
    newText: string;
}
export declare function diffLines(from: string, to: string): ChangedLines;
export declare function getChange(oldStr: string, newStr: string): Change;
export declare function patchLine(from: string, to: string, fill?: string): string;
export {};
