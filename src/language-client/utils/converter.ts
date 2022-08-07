'use strict'
/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, CodeLensParams, CompletionContext, CompletionList, CompletionParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, DocumentSymbolParams, InsertReplaceEdit, Position, Range, ReferenceParams, SignatureHelpContext, SignatureHelpParams, TextDocumentIdentifier, TextDocumentItem, TextDocumentPositionParams, VersionedTextDocumentIdentifier, WillSaveTextDocumentParams } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { TextDocumentWillSaveEvent } from '../../types'
import { omit } from '../../util/lodash'

export function convertToTextDocumentItem(document: TextDocument): TextDocumentItem {
  return {
    uri: document.uri,
    languageId: document.languageId,
    version: document.version,
    text: document.getText()
  }
}

export function asCloseTextDocumentParams(document: TextDocument): DidCloseTextDocumentParams {
  return {
    textDocument: {
      uri: document.uri
    }
  }
}

export function asChangeTextDocumentParams(document: TextDocument): DidChangeTextDocumentParams {
  let result: DidChangeTextDocumentParams = {
    textDocument: {
      uri: document.uri,
      version: document.version
    },
    contentChanges: [{ text: document.getText() }]
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
export function asCompletionList(value: CompletionList, allCommitCharacters?: string[], token?: CancellationToken): CompletionList {
  if (!value) return
  if (!value.itemDefaults) return value

  const items = value.items.map(item => {
    item.data = item.data ?? value.itemDefaults.data
    item.commitCharacters = item.commitCharacters ?? value.itemDefaults.commitCharacters
    item.insertTextMode = item.insertTextMode ?? value.itemDefaults.insertTextMode
    item.insertTextFormat = item.insertTextFormat ?? value.itemDefaults.insertTextFormat
    const editRange = value.itemDefaults.editRange
    if (editRange) {
      item.textEditText = item.textEditText ?? item.label
      item.insertText = item.insertText ?? item.textEditText
      if (Range.is(editRange)) {
        item.textEdit = item.textEdit ?? { range: editRange, newText: item.textEditText }
      } else {
        item.textEdit = item.textEdit ?? InsertReplaceEdit.create(item.textEditText, editRange.insert, editRange.replace)
      }
    }

    return item
  })

  return CompletionList.create(items, value.isIncomplete)
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
