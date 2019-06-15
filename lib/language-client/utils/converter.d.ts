import { CodeLensParams, CompletionContext, CompletionParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, DocumentSelector, DocumentSymbolParams, Position, ReferenceParams, TextDocument, TextDocumentIdentifier, TextDocumentItem, TextDocumentPositionParams, VersionedTextDocumentIdentifier, WillSaveTextDocumentParams } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { TextDocumentWillSaveEvent } from '../../types';
export declare function asLanguageIds(documentSelector: DocumentSelector): string[];
export declare function convertToTextDocumentItem(document: TextDocument): TextDocumentItem;
export declare function asCloseTextDocumentParams(document: TextDocument): DidCloseTextDocumentParams;
export declare function asChangeTextDocumentParams(document: TextDocument): DidChangeTextDocumentParams;
export declare function asWillSaveTextDocumentParams(event: TextDocumentWillSaveEvent): WillSaveTextDocumentParams;
export declare function asVersionedTextDocumentIdentifier(textDocument: TextDocument): VersionedTextDocumentIdentifier;
export declare function asSaveTextDocumentParams(document: TextDocument, includeText: boolean): DidSaveTextDocumentParams;
export declare function asUri(resource: URI): string;
export declare function asCompletionParams(textDocument: TextDocument, position: Position, context: CompletionContext): CompletionParams;
export declare function asTextDocumentPositionParams(textDocument: TextDocument, position: Position): TextDocumentPositionParams;
export declare function asTextDocumentIdentifier(textDocument: TextDocument): TextDocumentIdentifier;
export declare function asReferenceParams(textDocument: TextDocument, position: Position, options: {
    includeDeclaration: boolean;
}): ReferenceParams;
export declare function asDocumentSymbolParams(textDocument: TextDocument): DocumentSymbolParams;
export declare function asCodeLensParams(textDocument: TextDocument): CodeLensParams;
