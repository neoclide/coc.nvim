import type * as protocol from 'vscode-languageserver-protocol'
import { DocumentUri, TextDocument } from 'vscode-languageserver-textdocument'
import { Position } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { FileCreateEvent, FileDeleteEvent, FileRenameEvent, TextDocumentWillSaveEvent } from '../../core/files'
import { DidChangeTextDocumentParams as TextDocumentChangeEvent } from '../../types'
import { omit } from '../../util/lodash'

export interface Converter {
  asUri(value: URI): string

  asTextDocumentItem(textDocument: TextDocument): protocol.TextDocumentItem

  asTextDocumentIdentifier(textDocument: TextDocument): protocol.TextDocumentIdentifier

  asVersionedTextDocumentIdentifier(textDocument: TextDocument): protocol.VersionedTextDocumentIdentifier

  asOpenTextDocumentParams(textDocument: TextDocument): protocol.DidOpenTextDocumentParams

  asChangeTextDocumentParams(event: TextDocumentChangeEvent): protocol.DidChangeTextDocumentParams
  asFullChangeTextDocumentParams(textDocument: TextDocument): protocol.DidChangeTextDocumentParams

  asCloseTextDocumentParams(textDocument: TextDocument): protocol.DidCloseTextDocumentParams

  asSaveTextDocumentParams(textDocument: TextDocument, includeText?: boolean): protocol.DidSaveTextDocumentParams
  asWillSaveTextDocumentParams(event: TextDocumentWillSaveEvent): protocol.WillSaveTextDocumentParams

  asDidCreateFilesParams(event: FileCreateEvent): protocol.CreateFilesParams
  asDidRenameFilesParams(event: FileRenameEvent): protocol.RenameFilesParams
  asDidDeleteFilesParams(event: FileDeleteEvent): protocol.DeleteFilesParams
  asWillCreateFilesParams(event: FileCreateEvent): protocol.CreateFilesParams
  asWillRenameFilesParams(event: FileRenameEvent): protocol.RenameFilesParams
  asWillDeleteFilesParams(event: FileDeleteEvent): protocol.DeleteFilesParams

  asTextDocumentPositionParams(textDocument: TextDocument, position: Position): protocol.TextDocumentPositionParams

  asCompletionParams(textDocument: TextDocument, position: Position, context: protocol.CompletionContext): protocol.CompletionParams

  asSignatureHelpParams(textDocument: TextDocument, position: Position, context: protocol.SignatureHelpContext): protocol.SignatureHelpParams

  asReferenceParams(textDocument: TextDocument, position: Position, options: { includeDeclaration: boolean }): protocol.ReferenceParams

  asDocumentSymbolParams(textDocument: TextDocument): protocol.DocumentSymbolParams

  asCodeLensParams(textDocument: TextDocument): protocol.CodeLensParams

  asDocumentLinkParams(textDocument: TextDocument): protocol.DocumentLinkParams
}

export interface URIConverter {
  (value: URI): string
}

export function createConverter(uriConverter?: URIConverter): Converter {
  uriConverter = uriConverter || ((value: URI) => value.toString())

  function asUri(value: URI | DocumentUri): string {
    if (URI.isUri(value)) {
      return uriConverter(value)
    } else {
      return uriConverter(URI.parse(value))
    }
  }

  function asTextDocumentItem(textDocument: TextDocument): protocol.TextDocumentItem {
    return {
      uri: asUri(textDocument.uri),
      languageId: textDocument.languageId,
      version: textDocument.version,
      text: textDocument.getText()
    }
  }

  function asTextDocumentIdentifier(textDocument: TextDocument): protocol.TextDocumentIdentifier {
    return {
      uri: asUri(textDocument.uri)
    }
  }

  function asVersionedTextDocumentIdentifier(textDocument: TextDocument): protocol.VersionedTextDocumentIdentifier {
    return {
      uri: asUri(textDocument.uri),
      version: textDocument.version
    }
  }

  function asOpenTextDocumentParams(textDocument: TextDocument): protocol.DidOpenTextDocumentParams {
    return {
      textDocument: asTextDocumentItem(textDocument)
    }
  }

  function asChangeTextDocumentParams(event: TextDocumentChangeEvent): protocol.DidChangeTextDocumentParams {
    let { textDocument, contentChanges } = event
    let result: protocol.DidChangeTextDocumentParams = {
      textDocument: {
        uri: asUri(textDocument.uri),
        version: textDocument.version
      },
      contentChanges: contentChanges.slice()
    }
    return result
  }

  function asFullChangeTextDocumentParams(textDocument: TextDocument): protocol.DidChangeTextDocumentParams {
    return {
      textDocument: asVersionedTextDocumentIdentifier(textDocument),
      contentChanges: [{ text: textDocument.getText() }]
    }
  }

  function asCloseTextDocumentParams(textDocument: TextDocument): protocol.DidCloseTextDocumentParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument)
    }
  }

  function asSaveTextDocumentParams(textDocument: TextDocument, includeText = false): protocol.DidSaveTextDocumentParams {
    let result: protocol.DidSaveTextDocumentParams = {
      textDocument: asVersionedTextDocumentIdentifier(textDocument)
    }
    if (includeText) {
      result.text = textDocument.getText()
    }
    return result
  }

  function asWillSaveTextDocumentParams(event: TextDocumentWillSaveEvent): protocol.WillSaveTextDocumentParams {
    return {
      textDocument: asTextDocumentIdentifier(event.document),
      reason: event.reason
    }
  }

  function asDidCreateFilesParams(event: FileCreateEvent): protocol.CreateFilesParams {
    return {
      files: event.files.map(file => ({ uri: asUri(file) }))
    }
  }

  function asDidRenameFilesParams(event: FileRenameEvent): protocol.RenameFilesParams {
    return {
      files: event.files.map(file => ({ oldUri: asUri(file.oldUri), newUri: asUri(file.newUri) })
      )
    }
  }

  function asDidDeleteFilesParams(event: FileDeleteEvent): protocol.DeleteFilesParams {
    return {
      files: event.files.map(file => ({ uri: asUri(file) }))
    }
  }

  function asWillCreateFilesParams(event: FileCreateEvent): protocol.CreateFilesParams {
    return {
      files: event.files.map(file => ({ uri: asUri(file) }))
    }
  }

  function asWillRenameFilesParams(event: FileRenameEvent): protocol.RenameFilesParams {
    return {
      files: event.files.map(file => ({ oldUri: asUri(file.oldUri), newUri: asUri(file.newUri) }))
    }
  }

  function asWillDeleteFilesParams(event: FileDeleteEvent): protocol.DeleteFilesParams {
    return {
      files: event.files.map(file => ({ uri: asUri(file) }))
    }
  }

  function asTextDocumentPositionParams(textDocument: TextDocument, position: Position): protocol.TextDocumentPositionParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument),
      position
    }
  }

  function asCompletionParams(textDocument: TextDocument, position: Position, context: protocol.CompletionContext): protocol.CompletionParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument),
      position,
      context: omit(context, ['option'])
    }
  }

  function asSignatureHelpParams(textDocument: TextDocument, position: Position, context: protocol.SignatureHelpContext): protocol.SignatureHelpParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument),
      position,
      context
    }
  }

  function asReferenceParams(textDocument: TextDocument, position: Position, options: { includeDeclaration: boolean }): protocol.ReferenceParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument),
      position,
      context: { includeDeclaration: options.includeDeclaration }
    }
  }

  function asDocumentSymbolParams(textDocument: TextDocument): protocol.DocumentSymbolParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument)
    }
  }

  function asCodeLensParams(textDocument: TextDocument): protocol.CodeLensParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument)
    }
  }

  function asDocumentLinkParams(textDocument: TextDocument): protocol.DocumentLinkParams {
    return {
      textDocument: asTextDocumentIdentifier(textDocument)
    }
  }

  return {
    asUri,
    asTextDocumentItem,
    asTextDocumentIdentifier,
    asVersionedTextDocumentIdentifier,
    asOpenTextDocumentParams,
    asChangeTextDocumentParams,
    asFullChangeTextDocumentParams,
    asCloseTextDocumentParams,
    asSaveTextDocumentParams,
    asWillSaveTextDocumentParams,
    asDidCreateFilesParams,
    asDidRenameFilesParams,
    asDidDeleteFilesParams,
    asWillCreateFilesParams,
    asWillRenameFilesParams,
    asWillDeleteFilesParams,
    asTextDocumentPositionParams,
    asCompletionParams,
    asSignatureHelpParams,
    asReferenceParams,
    asDocumentSymbolParams,
    asCodeLensParams,
    asDocumentLinkParams,
  }
}
