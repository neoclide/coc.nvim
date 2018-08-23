/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CompletionItem, CompletionItemKind, InsertTextFormat, Position, TextEdit } from 'vscode-languageserver-protocol'
import Document from '../../../model/document'
import workspace from '../../../workspace'
import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
const logger = require('../../../util/logger')('typscript-utils-completionItem')

export function resolveItem(
  item: CompletionItem,
  document: Document,
): void {
  let { textEdit, label } = item // tslint:disable-line
  let { position } = item.data
  if (textEdit) return
  // try replace more characters after cursor
  const wordRange = document.getWordRangeAtPosition(position)
  let text = document.textDocument.getText({
    start: {
      line: position.line,
      character: Math.max(0, position.character - label.length),
    },
    end: {
      line: position.line,
      character: position.character
    }
  })

  text = text.toLowerCase()
  const entryName = label.toLowerCase()

  for (let i = entryName.length; i >= 0; --i) {
    if (text.endsWith(entryName.substr(0, i)) &&
      (!wordRange ||
        wordRange.start.character > position.character - i)) {
      item.textEdit = {
        newText: label,
        range: {
          start: {
            line: position.line,
            character: Math.max(0, position.character - i)
          },
          end: {
            line: position.line,
            character: position.character
          }
        }
      }
      break
    }
  }
}

export function convertCompletionEntry(
  tsEntry: Proto.CompletionEntry,
  uri: string,
  position: Position,
  useCodeSnippetsOnMethodSuggest: boolean
): CompletionItem {
  let label = tsEntry.name
  let sortText = tsEntry.sortText
  if (tsEntry.isRecommended) {
    // Make sure isRecommended property always comes first
    // https://github.com/Microsoft/vscode/issues/40325
    sortText = '\0' + sortText
  } else if (tsEntry.source) {
    // De-prioritze auto-imports
    // https://github.com/Microsoft/vscode/issues/40311
    sortText = '\uffff' + sortText
  } else {
    sortText = tsEntry.sortText
  }
  let kind = convertKind(tsEntry.kind)
  let insertTextFormat = (
    useCodeSnippetsOnMethodSuggest &&
    (kind === CompletionItemKind.Function ||
      kind === CompletionItemKind.Method)
  ) ? InsertTextFormat.Snippet : InsertTextFormat.PlainText

  let textEdit: TextEdit = null
  let insertText = tsEntry.insertText
  if (insertText) {
    let document = workspace.getDocument(uri)
    textEdit = {
      range: document.getWordRangeAtPosition(position),
      newText: insertText
    }
    insertText = null
  }
  let optional = tsEntry.kindModifiers && tsEntry.kindModifiers.match(/\boptional\b/)
  return {
    label,
    insertText,
    kind,
    textEdit,
    insertTextFormat,
    sortText,
    data: {
      uri,
      optional,
      position,
      source: tsEntry.source || ''
    }
  }
}

function convertKind(kind: string): CompletionItemKind {
  switch (kind) {
    case PConst.Kind.primitiveType:
    case PConst.Kind.keyword:
      return CompletionItemKind.Keyword
    case PConst.Kind.const:
      return CompletionItemKind.Constant
    case PConst.Kind.let:
    case PConst.Kind.variable:
    case PConst.Kind.localVariable:
    case PConst.Kind.alias:
      return CompletionItemKind.Variable
    case PConst.Kind.memberVariable:
    case PConst.Kind.memberGetAccessor:
    case PConst.Kind.memberSetAccessor:
      return CompletionItemKind.Field
    case PConst.Kind.function:
      return CompletionItemKind.Function
    case PConst.Kind.memberFunction:
    case PConst.Kind.constructSignature:
    case PConst.Kind.callSignature:
    case PConst.Kind.indexSignature:
      return CompletionItemKind.Method
    case PConst.Kind.enum:
      return CompletionItemKind.Enum
    case PConst.Kind.module:
    case PConst.Kind.externalModuleName:
      return CompletionItemKind.Module
    case PConst.Kind.class:
    case PConst.Kind.type:
      return CompletionItemKind.Class
    case PConst.Kind.interface:
      return CompletionItemKind.Interface
    case PConst.Kind.warning:
    case PConst.Kind.file:
    case PConst.Kind.script:
      return CompletionItemKind.File
    case PConst.Kind.directory:
      return CompletionItemKind.Folder
  }
  return CompletionItemKind.Property
}
