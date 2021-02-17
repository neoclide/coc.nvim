import { CompletionItem, TextEdit, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver-protocol'
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
  let { label, data, insertTextFormat, insertText, textEdit } = item
  let word: string
  let newText: string
  if (data && typeof data.word === 'string') return data.word
  if (textEdit) {
    let { range } = textEdit as TextEdit
    newText = textEdit.newText
    if (range && range.start.line == range.end.line) {
      let { line, col, colnr } = opt
      let character = characterIndex(line, col)
      if (range.start.character > character) {
        let before = line.slice(character, range.start.character)
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
    && newText.includes('$')) {
    let parser = new SnippetParser()
    let text = parser.text(newText)
    word = text ? getValidWord(text, invalidInsertCharacters) : label
  } else {
    word = getValidWord(newText, invalidInsertCharacters) || label
  }
  return word || ''
}

export function getDocumentation(item: CompletionItem): string {
  let { documentation } = item
  if (!documentation) return ''
  if (typeof documentation === 'string') return documentation
  return documentation.value
}

export function completionKindString(kind: CompletionItemKind, map: Map<CompletionItemKind, string>, defaultValue = ''): string {
  return map.get(kind) || defaultValue
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
    if (invalidChars.includes(c)) {
      return text.slice(0, i)
    }
  }
  return text
}
