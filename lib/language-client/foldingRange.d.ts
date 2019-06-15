import { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, FoldingRange, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { FoldingContext, ProviderResult } from '../provider';
import { BaseLanguageClient, TextDocumentFeature } from './client';
export declare type ProvideFoldingRangeSignature = (document: TextDocument, context: FoldingContext, token: CancellationToken) => ProviderResult<FoldingRange[]>;
export interface FoldingRangeProviderMiddleware {
    provideFoldingRanges?: (this: void, document: TextDocument, context: FoldingContext, token: CancellationToken, next: ProvideFoldingRangeSignature) => ProviderResult<FoldingRange[]>;
}
export declare class FoldingRangeFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
