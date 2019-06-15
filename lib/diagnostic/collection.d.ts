import { Diagnostic, Event } from 'vscode-languageserver-protocol';
import { DiagnosticCollection } from '../types';
export default class Collection implements DiagnosticCollection {
    private diagnosticsMap;
    private _onDispose;
    private _onDidDiagnosticsChange;
    private _onDidDiagnosticsClear;
    readonly name: string;
    readonly onDispose: Event<void>;
    readonly onDidDiagnosticsChange: Event<string>;
    readonly onDidDiagnosticsClear: Event<string[]>;
    constructor(owner: string);
    set(uri: string, diagnostics: Diagnostic[] | null): void;
    set(entries: [string, Diagnostic[] | null][]): void;
    delete(uri: string): void;
    clear(): void;
    forEach(callback: (uri: string, diagnostics: Diagnostic[], collection: DiagnosticCollection) => any, thisArg?: any): void;
    get(uri: string): Diagnostic[];
    has(uri: string): boolean;
    dispose(): void;
}
