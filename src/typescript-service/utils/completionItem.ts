import * as Proto from '../protocol'
import * as PConst from '../protocol.const'
import Document from '../../model/document'
import {
  CompletionItemKind,
  CompletionItem,
  InsertTextFormat,
  Position,
} from 'vscode-languageserver-protocol'
import * as typeConverters from '../utils/typeConverters'
const logger = require('../../util/logger')('typscript-utils-completionItem')

export function resolveItem(
  item: CompletionItem,
  document: Document,
):void {
  let {textEdit, label} = item
  let {position} = item.data
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
  uri:string,
  preText:string,
  position: Position,
  enableDotCompletions: boolean,
  useCodeSnippetsOnMethodSuggest: boolean
):CompletionItem {
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
  let textEdit = tsEntry.replacementSpan
    ? {
      range: typeConverters.Range.fromTextSpan(tsEntry.replacementSpan),
      newText: label
    } : null
  let insertText = tsEntry.insertText
  if (insertText && textEdit) {
    textEdit.newText = insertText
    let {range} = textEdit
    // Make sure we only replace a single line at most
    if (range.start.line !== range.end.line) {
      textEdit.range = {
        start: range.start,
        end: {
          line: range.start.line,
          character: preText.length
        }
      }
    }
    insertText = null
  }
  if (tsEntry.kindModifiers && tsEntry.kindModifiers.match(/\boptional\b/)) {
    insertText = label
    label = `${insertText}?`
  }
  return {
    label,
    insertText,
    kind,
    textEdit,
    commitCharacters: getCommitCharacters(
      enableDotCompletions,
      !useCodeSnippetsOnMethodSuggest,
      tsEntry.kind
    ),
    insertTextFormat,
    sortText,
    data: {
      uri,
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

function getCommitCharacters(
  enableDotCompletions: boolean,
  enableCallCompletions: boolean,
  kind: string
): string[] | undefined {
  switch (kind) {
    case PConst.Kind.memberGetAccessor:
    case PConst.Kind.memberSetAccessor:
    case PConst.Kind.constructSignature:
    case PConst.Kind.callSignature:
    case PConst.Kind.indexSignature:
    case PConst.Kind.enum:
    case PConst.Kind.interface:
      return enableDotCompletions ? ['.'] : undefined

    case PConst.Kind.module:
    case PConst.Kind.alias:
    case PConst.Kind.const:
    case PConst.Kind.let:
    case PConst.Kind.variable:
    case PConst.Kind.localVariable:
    case PConst.Kind.memberVariable:
    case PConst.Kind.class:
    case PConst.Kind.function:
    case PConst.Kind.memberFunction:
      return enableDotCompletions
        ? enableCallCompletions
        ? ['.', '(']
        : ['.']
        : undefined
  }
  return undefined
}
