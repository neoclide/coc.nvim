import { CancellationToken, Disposable, DocumentSelector, DocumentSymbol, SymbolInformation, TextDocument } from 'vscode-languageserver-protocol';
import { DocumentSymbolProvider } from './index';
import Manager from './manager';
export default class DocumentSymbolManager extends Manager<DocumentSymbolProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable;
    provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<SymbolInformation[] | DocumentSymbol[]>;
    dispose(): void;
}
