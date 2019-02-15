import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver-types'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption } from '../types'
import { byteSlice, characterIndex } from './string'
const logger = require('./logger')('util-complete')

export function getPosition(opt: CompleteOption): Position {
  let { line, linenr, colnr } = opt
  let part = byteSlice(line, 0, colnr - 1)
  return {
    line: linenr - 1,
    character: part.length
  }
}

export function getWord(item: CompletionItem, opt: CompleteOption, invalidInsertCharacters: string[]): string {
  // tslint:disable-next-line: deprecation
  let { label, insertTextFormat, insertText, textEdit } = item
  let word: string
  let newText: string
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
  if (insertTextFormat == InsertTextFormat.Snippet) {
    if (newText) {
      let parser = new SnippetParser()
      let snippet = parser.text(newText.trim())
      word = snippet ? getValidWord(snippet, invalidInsertCharacters) : label
    } else {
      word = label
    }
  } else {
    word = getValidWord(newText, invalidInsertCharacters) || label
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
    if (invalidChars.indexOf(c) !== -1 || c == '\r' || c == '\n') {
      return text.slice(0, i)
    }
  }
  return text
}
