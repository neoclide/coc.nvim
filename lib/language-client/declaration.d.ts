import { Declaration, ClientCapabilities, Disposable, CancellationToken, ServerCapabilities, TextDocumentRegistrationOptions, DocumentSelector, TextDocument, Position } from 'vscode-languageserver-protocol';
import { TextDocumentFeature, BaseLanguageClient } from './client';
import { ProviderResult } from '../provider';
export interface ProvideDeclarationSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration>;
}
export interface DeclarationMiddleware {
    provideDeclaration?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDeclarationSignature) => ProviderResult<Declaration>;
}
export declare class DeclarationFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
