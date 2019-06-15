import { CancellationToken, ClientCapabilities, Color, ColorInformation, ColorPresentation, Disposable, DocumentSelector, Range, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol';
import { ProviderResult } from '../provider';
import { BaseLanguageClient, TextDocumentFeature } from './client';
export declare type ProvideDocumentColorsSignature = (document: TextDocument, token: CancellationToken) => ProviderResult<ColorInformation[]>;
export declare type ProvideColorPresentationSignature = (color: Color, context: {
    document: TextDocument;
    range: Range;
}, token: CancellationToken) => ProviderResult<ColorPresentation[]>;
export interface ColorProviderMiddleware {
    provideDocumentColors?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDocumentColorsSignature) => ProviderResult<ColorInformation[]>;
    provideColorPresentations?: (this: void, color: Color, context: {
        document: TextDocument;
        range: Range;
    }, token: CancellationToken, next: ProvideColorPresentationSignature) => ProviderResult<ColorPresentation[]>;
}
export declare class ColorProviderFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
    constructor(client: BaseLanguageClient);
    fillClientCapabilities(capabilites: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable;
}
