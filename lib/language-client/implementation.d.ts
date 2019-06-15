import { CancellationToken, ClientCapabilities, Definition, Disposable, DocumentSelector, Position, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { ProviderResult } from '../provider';
import { BaseLanguageClient, TextDocumentFeature } from './client';
export interface ProvideImplementationSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition>;
}
export interface ImplementationMiddleware {
    provideImplementation?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideImplementationSignature) => ProviderResult<Definition>;
}
export declare class ImplementationFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
