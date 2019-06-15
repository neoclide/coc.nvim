import { CancellationToken, Disposable, DocumentLink, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol';
import { DocumentLinkProvider } from './index';
import Manager from './manager';
export default class DocumentLinkManager extends Manager<DocumentLinkProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable;
    private _provideDocumentLinks;
    provideDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLink[]>;
    resolveDocumentLink(link: DocumentLink, token: CancellationToken): Promise<DocumentLink>;
    dispose(): void;
}
