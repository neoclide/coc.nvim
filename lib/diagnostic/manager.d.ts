import { Diagnostic, Disposable, Range, TextDocument } from 'vscode-languageserver-protocol';
import { DiagnosticItem } from '../types';
import { DiagnosticBuffer } from './buffer';
import DiagnosticCollection from './collection';
export interface DiagnosticConfig {
    enableSign: boolean;
    checkCurrentLine: boolean;
    enableMessage: string;
    virtualText: boolean;
    displayByAle: boolean;
    srcId: number;
    locationlist: boolean;
    signOffset: number;
    errorSign: string;
    warningSign: string;
    infoSign: string;
    hintSign: string;
    level: number;
    messageTarget: string;
    joinMessageLines: boolean;
    maxWindowHeight: number;
    refreshAfterSave: boolean;
    refreshOnInsertMode: boolean;
    virtualTextSrcId: number;
    virtualTextPrefix: string;
    virtualTextLines: number;
    virtualTextLineSeparator: string;
}
export declare class DiagnosticManager implements Disposable {
    config: DiagnosticConfig;
    enabled: boolean;
    readonly buffers: DiagnosticBuffer[];
    private floatFactory;
    private collections;
    private disposables;
    private lastMessage;
    private timer;
    init(): void;
    private createDiagnosticBuffer;
    setConfigurationErrors(init?: boolean): void;
    /**
     * Create collection by name
     */
    create(name: string): DiagnosticCollection;
    /**
     * Get diagnostics ranges from document
     */
    getSortedRanges(uri: string): Range[];
    /**
     * Get readonly diagnostics for a buffer
     */
    getDiagnostics(uri: string): ReadonlyArray<Diagnostic>;
    getDiagnosticsInRange(document: TextDocument, range: Range): Diagnostic[];
    /**
     * Jump to previouse diagnostic position
     */
    jumpPrevious(): Promise<void>;
    /**
     * Jump to next diagnostic position
     */
    jumpNext(): Promise<void>;
    /**
     * All diagnostics of current workspace
     */
    getDiagnosticList(): DiagnosticItem[];
    /**
     * Echo diagnostic message of currrent position
     */
    echoMessage(truncate?: boolean): Promise<void>;
    hideFloat(): void;
    dispose(): void;
    private readonly nvim;
    private setConfiguration;
    private getCollections;
    private shouldValidate;
    private refreshBuffer;
    private jumpTo;
}
declare const _default: DiagnosticManager;
export default _default;
