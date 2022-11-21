'use strict'
import type { CodeLensParams, CompletionContext, CompletionParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentSymbolParams, ReferenceParams, RelativePattern, SignatureHelpContext, SignatureHelpParams, TextDocumentPositionParams, WillSaveTextDocumentParams } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, TextDocumentIdentifier, TextDocumentItem, VersionedTextDocumentIdentifier } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { TextDocumentWillSaveEvent } from '../../core/files'
import RelativePatternImpl from '../../model/relativePattern'
import { DidChangeTextDocumentParams as TextDocumentChangeEvent } from '../../types'
import { omit } from '../../util/lodash'

export function convertToTextDocumentItem(document: TextDocument): TextDocumentItem {
  return {
    uri: document.uri,
    languageId: document.languageId,
    version: document.version,
    text: document.getText()
  }
}

export function asOpenTextDocumentParams(textDocument: TextDocument): DidOpenTextDocumentParams {
  return {
    textDocument: convertToTextDocumentItem(textDocument)
  }
}

export function asRelativePattern(rp: RelativePattern): RelativePatternImpl {
  let { baseUri, pattern } = rp
  if (typeof baseUri === 'string') {
    return new RelativePatternImpl(URI.parse(baseUri), pattern)
  }
  return new RelativePatternImpl(baseUri, pattern)
}

export function asCloseTextDocumentParams(document: TextDocument): DidCloseTextDocumentParams {
  return {
    textDocument: {
      uri: document.uri
    }
  }
}

export function asFullChangeTextDocumentParams(document: TextDocument): DidChangeTextDocumentParams {
  let result: DidChangeTextDocumentParams = {
    textDocument: {
      uri: document.uri,
      version: document.version
    },
    contentChanges: [{ text: document.getText() }]
  }
  return result
}

export function asChangeTextDocumentParams(event: TextDocumentChangeEvent): DidChangeTextDocumentParams {
  let { textDocument, contentChanges } = event
  let result: DidChangeTextDocumentParams = {
    textDocument: {
      uri: textDocument.uri,
      version: textDocument.version
    },
    contentChanges: contentChanges.slice()
  }
  return result
}

export function asWillSaveTextDocumentParams(event: TextDocumentWillSaveEvent): WillSaveTextDocumentParams {
  return {
    textDocument: asVersionedTextDocumentIdentifier(event.document),
    reason: event.reason
  }
}

export function asVersionedTextDocumentIdentifier(textDocument: TextDocument): VersionedTextDocumentIdentifier {
  return {
    uri: textDocument.uri,
    version: textDocument.version
  }
}

export function asSaveTextDocumentParams(document: TextDocument, includeText: boolean): DidSaveTextDocumentParams {
  let result: DidSaveTextDocumentParams = {
    textDocument: asVersionedTextDocumentIdentifier(document)
  }
  if (includeText) {
    result.text = document.getText()
  }
  return result
}

export function asUri(resource: URI): string {
  return resource.toString()
}

export function asCompletionParams(textDocument: TextDocument, position: Position, context: CompletionContext): CompletionParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position,
    context: omit(context, ['option']),
  }
}

export function asTextDocumentPositionParams(textDocument: TextDocument, position: Position): TextDocumentPositionParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position
  }
}

export function asSignatureHelpParams(textDocument: TextDocument, position: Position, context: SignatureHelpContext): SignatureHelpParams {
  return {
    textDocument: asTextDocumentIdentifier(textDocument),
    position,
    context
  }
}

export function asTextDocumentIdentifier(textDocument: TextDocument): TextDocumentIdentifier {
  return {
    uri: textDocument.uri
  }
}

export function asReferenceParams(textDocument: TextDocument, position: Position, options: { includeDeclaration: boolean }): ReferenceParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position,
    context: { includeDeclaration: options.includeDeclaration }
  }
}

export function asDocumentSymbolParams(textDocument: TextDocument): DocumentSymbolParams {
  return {
    textDocument: {
      uri: textDocument.uri
    }
  }
}

export function asCodeLensParams(textDocument: TextDocument): CodeLensParams {
  return {
    textDocument: {
      uri: textDocument.uri
    }
  }
}
