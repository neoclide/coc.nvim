import { SelectionRange, SelectionRangeClientCapabilities, SelectionRangeServerCapabilities, CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { ProviderResult } from '../provider';
import { BaseLanguageClient, TextDocumentFeature } from './client';
export interface SelectionRangeProviderMiddleware {
    provideSelectionRanges?: (this: void, document: TextDocument, positions: Position[], token: CancellationToken, next: ProvideSelectionRangeSignature) => ProviderResult<SelectionRange[]>;
}
export interface ProvideSelectionRangeSignature {
    (document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>;
}
export declare class SelectionRangeFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities & SelectionRangeClientCapabilities): void;
    initialize(capabilities: ServerCapabilities & SelectionRangeServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
