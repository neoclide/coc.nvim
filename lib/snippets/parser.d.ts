import { Range } from 'vscode-languageserver-protocol';
export declare const enum TokenType {
    Dollar = 0,
    Colon = 1,
    Comma = 2,
    CurlyOpen = 3,
    CurlyClose = 4,
    Backslash = 5,
    Forwardslash = 6,
    Pipe = 7,
    Int = 8,
    VariableName = 9,
    Format = 10,
    Plus = 11,
    Dash = 12,
    QuestionMark = 13,
    EOF = 14
}
export interface Token {
    type: TokenType;
    pos: number;
    len: number;
}
export declare class Scanner {
    private static _table;
    static isDigitCharacter(ch: number): boolean;
    static isVariableCharacter(ch: number): boolean;
    value: string;
    pos: number;
    constructor();
    text(value: string): void;
    tokenText(token: Token): string;
    next(): Token;
}
export declare abstract class Marker {
    readonly _markerBrand: any;
    parent: Marker;
    protected _children: Marker[];
    appendChild(child: Marker): this;
    setOnlyChild(child: Marker): void;
    replace(child: Marker, others: Marker[]): void;
    readonly children: Marker[];
    readonly snippet: TextmateSnippet | undefined;
    toString(): string;
    abstract toTextmateString(): string;
    len(): number;
    readonly next: Marker | null;
    abstract clone(): Marker;
}
export declare class Text extends Marker {
    value: string;
    static escape(value: string): string;
    constructor(value: string);
    toString(): string;
    toTextmateString(): string;
    len(): number;
    clone(): Text;
}
export declare abstract class TransformableMarker extends Marker {
    transform: Transform;
}
export declare class Placeholder extends TransformableMarker {
    index: number;
    static compareByIndex(a: Placeholder, b: Placeholder): number;
    constructor(index: number);
    readonly isFinalTabstop: boolean;
    readonly choice: Choice | undefined;
    toTextmateString(): string;
    clone(): Placeholder;
}
export declare class Choice extends Marker {
    readonly options: Text[];
    appendChild(marker: Marker): this;
    toString(): string;
    toTextmateString(): string;
    len(): number;
    clone(): Choice;
}
export declare class Transform extends Marker {
    regexp: RegExp;
    resolve(value: string): string;
    private _replace;
    toString(): string;
    toTextmateString(): string;
    clone(): Transform;
}
export declare class FormatString extends Marker {
    readonly index: number;
    readonly shorthandName?: string;
    readonly ifValue?: string;
    readonly elseValue?: string;
    constructor(index: number, shorthandName?: string, ifValue?: string, elseValue?: string);
    resolve(value: string): string;
    private _toPascalCase;
    toTextmateString(): string;
    clone(): FormatString;
}
export declare class Variable extends TransformableMarker {
    name: string;
    constructor(name: string);
    resolve(resolver: VariableResolver): boolean;
    toTextmateString(): string;
    clone(): Variable;
}
export interface VariableResolver {
    resolve(variable: Variable): string | undefined;
}
export declare class TextmateSnippet extends Marker {
    private _placeholders?;
    readonly placeholderInfo: {
        all: Placeholder[];
        last?: Placeholder;
    };
    readonly placeholders: Placeholder[];
    readonly maxIndexNumber: number;
    readonly minIndexNumber: number;
    insertSnippet(snippet: string, id: number, range: Range): number;
    updatePlaceholder(id: number, val: string): void;
    /**
     * newText after update with value
     */
    getPlaceholderText(id: number, value: string): string;
    offset(marker: Marker): number;
    fullLen(marker: Marker): number;
    enclosingPlaceholders(placeholder: Placeholder): Placeholder[];
    resolveVariables(resolver: VariableResolver): this;
    appendChild(child: Marker): this;
    replace(child: Marker, others: Marker[]): void;
    toTextmateString(): string;
    clone(): TextmateSnippet;
    walk(visitor: (marker: Marker) => boolean): void;
}
export declare class SnippetParser {
    static escape(value: string): string;
    private _scanner;
    private _token;
    text(value: string): string;
    parse(value: string, insertFinalTabstop?: boolean): TextmateSnippet;
    private _accept;
    private _backTo;
    private _until;
    private _parse;
    private _parseEscaped;
    private _parseTabstopOrVariableName;
    private _parseComplexPlaceholder;
    private _parseChoiceElement;
    private _parseComplexVariable;
    private _parseTransform;
    private _parseFormatString;
    private _parseAnything;
}
