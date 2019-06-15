import { Position, Range, TextEdit } from 'vscode-languageserver-protocol';
export declare function rangeInRange(r: Range, range: Range): boolean;
export declare function rangeOverlap(r: Range, range: Range): boolean;
export declare function rangeIntersect(r: Range, range: Range): boolean;
export declare function lineInRange(line: number, range: Range): boolean;
export declare function emptyRange(range: Range): boolean;
export declare function positionInRange(position: Position, range: Range): number;
export declare function comparePosition(position: Position, other: Position): number;
export declare function isSingleLine(range: Range): boolean;
export declare function getChangedPosition(start: Position, edit: TextEdit): {
    line: number;
    character: number;
};
export declare function adjustPosition(pos: Position, edit: TextEdit): Position;
export declare function positionToOffset(lines: string[], line: number, character: number): number;
export declare function editRange(range: Range, text: string, edit: TextEdit): string;
export declare function getChangedFromEdits(start: Position, edits: TextEdit[]): Position | null;
