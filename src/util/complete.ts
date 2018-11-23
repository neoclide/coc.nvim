import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver-types'
import { CompleteOption, VimCompleteItem } from '../types'
import { byteSlice } from './string'
import { objectLiteral } from './is'
const logger = require('./logger')('util-complete')

export function isCocItem(item: any): boolean {
  if (!item || !item.hasOwnProperty('user_data')) return false
  let { user_data } = item
  try {
    let res = JSON.parse(user_data)
    return res.cid != null
  } catch (e) {
    return false
  }
}

export function getPosition(opt: CompleteOption): Position {
  let { line, linenr, colnr } = opt
  let part = byteSlice(line, 0, colnr - 1)
  return {
    line: linenr - 1,
    character: part.length
  }
}

export function getWord(item: CompletionItem, parse: (text: string) => string): string {
  // tslint:disable-next-line: deprecation
  let { label, insertTextFormat, insertText, textEdit } = item
  let word: string
  if (insertTextFormat == InsertTextFormat.Snippet) {
    let snippet = textEdit ? textEdit.newText : insertText
    if (snippet) {
      let lines = parse(snippet.trim()).split('\n')
      word = lines[0] || label
    } else {
      word = label
    }
  } else {
    if (textEdit) {
      word = textEdit.newText
    } else {
      word = insertText || label
    }
  }
  return word
}

export function getDocumentation(item: CompletionItem): string | null {
  let { documentation } = item
  if (!documentation) return null
  if (typeof documentation === 'string') return documentation
  return documentation.value
}

export function completionKindString(kind: CompletionItemKind): string {
  switch (kind) {
    case CompletionItemKind.Text:
      return 'Text'
    case CompletionItemKind.Method:
      return 'Method'
    case CompletionItemKind.Function:
      return 'Function'
    case CompletionItemKind.Constructor:
      return 'Constructor'
    case CompletionItemKind.Field:
      return 'Field'
    case CompletionItemKind.Variable:
      return 'Variable'
    case CompletionItemKind.Class:
      return 'Class'
    case CompletionItemKind.Interface:
      return 'Interface'
    case CompletionItemKind.Module:
      return 'Module'
    case CompletionItemKind.Property:
      return 'Property'
    case CompletionItemKind.Unit:
      return 'Unit'
    case CompletionItemKind.Value:
      return 'Value'
    case CompletionItemKind.Enum:
      return 'Enum'
    case CompletionItemKind.Keyword:
      return 'Keyword'
    case CompletionItemKind.Snippet:
      return 'Snippet'
    case CompletionItemKind.Color:
      return 'Color'
    case CompletionItemKind.File:
      return 'File'
    case CompletionItemKind.Reference:
      return 'Reference'
    case CompletionItemKind.Folder:
      return 'Folder'
    case CompletionItemKind.EnumMember:
      return 'EnumMember'
    case CompletionItemKind.Constant:
      return 'Constant'
    case CompletionItemKind.Struct:
      return 'Struct'
    case CompletionItemKind.Event:
      return 'Event'
    case CompletionItemKind.Operator:
      return 'Operator'
    case CompletionItemKind.TypeParameter:
      return 'TypeParameter'
    default:
      return ''
  }
}

export function convertVimCompleteItem(item: CompletionItem, shortcut: string, parse: (text: string) => string): VimCompleteItem {
  let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
  let label = item.label.trim()
  // tslint:disable-next-line:deprecation
  if (isSnippet && item.insertText && item.insertText.indexOf('$') == -1) {
    // fix wrong insert format
    isSnippet = false
    item.insertTextFormat = InsertTextFormat.PlainText
  }
  let obj: VimCompleteItem = {
    word: getWord(item, parse),
    abbr: label,
    menu: item.detail ? `${item.detail.replace(/(\n|\t)/g, '').slice(0, 30)} [${shortcut}]` : `[${shortcut}]`,
    kind: completionKindString(item.kind),
    sortText: item.sortText || null,
    filterText: item.filterText || label,
    isSnippet
  }
  if (item.preselect) obj.preselect = true
  item.data = item.data || {}
  if (item.data.optional) obj.abbr = obj.abbr + '?'
  if (objectLiteral(item.data)) Object.assign(item.data, { word: obj.word })
  let document = getDocumentation(item)
  if (document) obj.info = document
  return obj
}

export function getSnippetDocumentation(languageId: string, body: string): string {
  languageId = languageId.replace(/react$/, '')
  let str = body.replace(/\$\d+/g, '').replace(/\$\{\d+(?::([^{]+))?\}/, '$1')
  str = '``` ' + languageId + '\n' + str + '\n' + '```'
  return str
}
