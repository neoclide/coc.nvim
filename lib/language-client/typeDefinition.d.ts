import { CancellationToken, ClientCapabilities, Definition, Disposable, DocumentSelector, Position, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { ProviderResult } from '../provider';
import { BaseLanguageClient, TextDocumentFeature } from './client';
export interface ProvideTypeDefinitionSignature {
    (// tslint:disable-line
    document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition>;
}
export interface TypeDefinitionMiddleware {
    provideTypeDefinition?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideTypeDefinitionSignature) => ProviderResult<Definition>;
}
export declare class TypeDefinitionFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
