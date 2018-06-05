import { Uri } from '../../vscode';
import { ITypeScriptServiceClient } from '../typescriptService';
export interface Diagnostics {
    delete(resource: Uri): void;
}
export default class BufferSyncSupport {
    private readonly client;
    private _validate;
    private readonly modeIds;
    private readonly diagnostics;
    private readonly disposables;
    private readonly syncedBuffers;
    private readonly pendingDiagnostics;
    private readonly diagnosticDelayer;
    constructor(client: ITypeScriptServiceClient, modeIds: string[], diagnostics: Diagnostics, validate: boolean);
    listen(): void;
    validate: boolean;
    handles(resource: Uri): boolean;
    reOpenDocuments(): void;
    dispose(): void;
    private onDidOpenTextDocument;
    private onDidCloseTextDocument;
    private onDidChangeTextDocument;
    requestAllDiagnostics(): void;
    requestDiagnostic(resource: Uri): void;
    hasPendingDiagnostics(resource: Uri): boolean;
    private sendPendingDiagnostics;
}
