import { CancellationToken, Disposable, DocumentHighlight, DocumentSelector, Position, TextDocument } from 'vscode-languageserver-protocol';
import { DocumentHighlightProvider } from './index';
import Manager from './manager';
export default class DocumentHighlightManager extends Manager<DocumentHighlightProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DocumentHighlightProvider): Disposable;
    provideDocumentHighlights(document: TextDocument, position: Position, token: CancellationToken): Promise<DocumentHighlight[]>;
    dispose(): void;
}
