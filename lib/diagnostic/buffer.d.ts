import { Diagnostic, Event, Disposable } from 'vscode-languageserver-protocol';
import Document from '../model/document';
import { DiagnosticConfig } from './manager';
export declare class DiagnosticBuffer implements Disposable {
    private config;
    private matchIds;
    private signIds;
    private sequence;
    private matchId;
    private readonly _onDidRefresh;
    diagnostics: ReadonlyArray<Diagnostic>;
    readonly onDidRefresh: Event<void>;
    readonly bufnr: number;
    readonly uri: string;
    refresh: (diagnosticItems: ReadonlyArray<Diagnostic>) => void;
    constructor(doc: Document, config: DiagnosticConfig);
    private readonly nvim;
    private _refresh;
    setLocationlist(diagnostics: ReadonlyArray<Diagnostic>, winid: number): void;
    private clearSigns;
    checkSigns(): Promise<void>;
    addSigns(diagnostics: ReadonlyArray<Diagnostic>): void;
    setDiagnosticInfo(diagnostics: ReadonlyArray<Diagnostic>): void;
    private addDiagnosticVText;
    clearHighlight(): void;
    addHighlight(diagnostics: ReadonlyArray<Diagnostic>, winid: any): void;
    private addHighlightNvim;
    private addHighlightVim;
    /**
     * Used on buffer unload
     *
     * @public
     * @returns {Promise<void>}
     */
    clear(): Promise<void>;
    hasMatch(match: number): boolean;
    dispose(): void;
}
