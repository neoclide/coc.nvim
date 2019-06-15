import { CancellationToken, Disposable, DocumentSelector, SymbolInformation, TextDocument } from 'vscode-languageserver-protocol';
import { WorkspaceSymbolProvider } from './index';
import Manager from './manager';
export default class WorkspaceSymbolManager extends Manager<WorkspaceSymbolProvider> implements Disposable {
    register(selector: DocumentSelector, provider: WorkspaceSymbolProvider): Disposable;
    provideWorkspaceSymbols(document: TextDocument, query: string, token: CancellationToken): Promise<SymbolInformation[]>;
    resolveWorkspaceSymbol(symbolInfo: SymbolInformation, token: CancellationToken): Promise<SymbolInformation>;
    dispose(): void;
}
