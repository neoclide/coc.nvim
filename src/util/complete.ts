import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver-types'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption } from '../types'
import { byteSlice, characterIndex } from './string'
import workspace from '../workspace'
const logger = require('./logger')('util-complete')
const invalidInsertCharacters = ['(', '<', '{', '[', '\r', '\n']
const config = workspace.getConfiguration('suggest.completionItemKindLabels')
const labels = new Map<CompletionItemKind, string>([
  [CompletionItemKind.Text, config.get('text', 'v')],
  [CompletionItemKind.Method, config.get('method', 'f')],
  [CompletionItemKind.Function, config.get('function', 'f')],
  [CompletionItemKind.Constructor, config.get('constructor', 'f')],
  [CompletionItemKind.Field, config.get('field', 'm')],
  [CompletionItemKind.Variable, config.get('variable', 'v')],
  [CompletionItemKind.Class, config.get('class', 'C')],
  [CompletionItemKind.Interface, config.get('interface', 'I')],
  [CompletionItemKind.Module, config.get('module', 'M')],
  [CompletionItemKind.Property, config.get('property', 'm')],
  [CompletionItemKind.Unit, config.get('unit', 'U')],
  [CompletionItemKind.Value, config.get('value', 'v')],
  [CompletionItemKind.Enum, config.get('enum', 'E')],
  [CompletionItemKind.Keyword, config.get('keyword', 'k')],
  [CompletionItemKind.Snippet, config.get('snippet', 'S')],
  [CompletionItemKind.Color, config.get('color', 'v')],
  [CompletionItemKind.File, config.get('file', 'F')],
  [CompletionItemKind.Reference, config.get('reference', 'r')],
  [CompletionItemKind.Folder, config.get('folder', 'F')],
  [CompletionItemKind.EnumMember, config.get('enumMember', 'm')],
  [CompletionItemKind.Constant, config.get('constant', 'v')],
  [CompletionItemKind.Struct, config.get('struct', 'S')],
  [CompletionItemKind.Event, config.get('event', 'E')],
  [CompletionItemKind.Operator, config.get('operator', 'O')],
  [CompletionItemKind.TypeParameter, config.get('typeParameter', 'T')],
])
const defaultLabel = config.get('default', '')

export function getPosition(opt: CompleteOption): Position {
  let { line, linenr, colnr } = opt
  let part = byteSlice(line, 0, colnr - 1)
  return {
    line: linenr - 1,
    character: part.length
  }
}

export function getWord(item: CompletionItem, opt: CompleteOption): string {
  // tslint:disable-next-line: deprecation
  let { label, data, insertTextFormat, insertText, textEdit } = item
  let word: string
  let newText: string
  if (data && data.word) return data.word
  if (textEdit) {
    let { range } = textEdit
    newText = textEdit.newText
    if (range && range.start.line == range.end.line) {
      let { line, col, colnr } = opt
      let character = characterIndex(line, col)
      if (range.start.character > character) {
        let before = line.slice(character - range.start.character)
        newText = before + newText
      } else {
        let start = line.slice(range.start.character, character)
        if (start.length && newText.startsWith(start)) {
          newText = newText.slice(start.length)
        }
      }
      character = characterIndex(line, colnr - 1)
      if (range.end.character > character) {
        let end = line.slice(character, range.end.character)
        if (newText.endsWith(end)) {
          newText = newText.slice(0, - end.length)
        }
      }
    }
  } else {
    newText = insertText
  }
  if (insertTextFormat == InsertTextFormat.Snippet
    && newText
    && newText.indexOf('$') !== -1) {
    let parser = new SnippetParser()
    let snippet = parser.text(newText)
    word = snippet ? getValidWord(snippet, invalidInsertCharacters) : label
  } else {
    word = getValidWord(newText, invalidInsertCharacters) || label
  }
  return word
}

export function getDocumentation(item: CompletionItem): string {
  let { documentation } = item
  if (!documentation) return ''
  if (typeof documentation === 'string') return documentation
  return documentation.value
}

export function completionKindString(kind: CompletionItemKind): string {
  const k = labels.get(kind)
  return k ? k : defaultLabel
}

export function getSnippetDocumentation(languageId: string, body: string): string {
  languageId = languageId.replace(/react$/, '')
  let str = body.replace(/\$\d+/g, '').replace(/\$\{\d+(?::([^{]+))?\}/, '$1')
  str = '``` ' + languageId + '\n' + str + '\n' + '```'
  return str
}

export function getValidWord(text: string, invalidChars: string[]): string {
  if (!text) return ''
  for (let i = 0; i < text.length; i++) {
    let c = text[i]
    if (invalidChars.indexOf(c) !== -1) {
      return text.slice(0, i)
    }
  }
  return text
}
