'use strict'
import { CompletionItemKind } from 'vscode-languageserver-types'
import { InsertChange } from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteDoneItem, CompleteOption, ExtendedCompleteItem, HighlightItem, ISource } from '../types'
import { toArray } from '../util/array'
import { byteIndex, byteSlice, characterIndex } from '../util/string'
const logger = require('../util/logger')('completion-util')

export function createKindMap(labels: { [key: string]: string }): Map<CompletionItemKind, string> {
  return new Map([
    [CompletionItemKind.Text, labels['text'] ?? 'v'],
    [CompletionItemKind.Method, labels['method'] ?? 'f'],
    [CompletionItemKind.Function, labels['function'] ?? 'f'],
    [CompletionItemKind.Constructor, typeof labels['constructor'] == 'function' ? 'f' : labels['con' + 'structor'] ?? ''],
    [CompletionItemKind.Field, labels['field'] ?? 'm'],
    [CompletionItemKind.Variable, labels['variable'] ?? 'v'],
    [CompletionItemKind.Class, labels['class'] ?? 'C'],
    [CompletionItemKind.Interface, labels['interface'] ?? 'I'],
    [CompletionItemKind.Module, labels['module'] ?? 'M'],
    [CompletionItemKind.Property, labels['property'] ?? 'm'],
    [CompletionItemKind.Unit, labels['unit'] ?? 'U'],
    [CompletionItemKind.Value, labels['value'] ?? 'v'],
    [CompletionItemKind.Enum, labels['enum'] ?? 'E'],
    [CompletionItemKind.Keyword, labels['keyword'] ?? 'k'],
    [CompletionItemKind.Snippet, labels['snippet'] ?? 'S'],
    [CompletionItemKind.Color, labels['color'] ?? 'v'],
    [CompletionItemKind.File, labels['file'] ?? 'F'],
    [CompletionItemKind.Reference, labels['reference'] ?? 'r'],
    [CompletionItemKind.Folder, labels['folder'] ?? 'F'],
    [CompletionItemKind.EnumMember, labels['enumMember'] ?? 'm'],
    [CompletionItemKind.Constant, labels['constant'] ?? 'v'],
    [CompletionItemKind.Struct, labels['struct'] ?? 'S'],
    [CompletionItemKind.Event, labels['event'] ?? 'E'],
    [CompletionItemKind.Operator, labels['operator'] ?? 'O'],
    [CompletionItemKind.TypeParameter, labels['typeParameter'] ?? 'T'],
  ])
}

export function toCompleteDoneItem(item: ExtendedCompleteItem | undefined): CompleteDoneItem | {} {
  if (!item) return {}
  return {
    word: item.word,
    abbr: item.abbr,
    kind: item.kind,
    source: item.source,
    isSnippet: item.isSnippet === true,
    menu: item.menu ?? `[${item.source}]`,
    user_data: typeof item.index === 'number' ? `${item.source}:${item.index}` : item.user_data
  }
}

export function shouldStop(bufnr: number, pretext: string, info: InsertChange, option: Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'colnr'>): boolean {
  let { pre } = info
  if (pre.length === 0 || pre[pre.length - 1] === ' ' || pre.length < pretext.length) return true
  if (option.bufnr != bufnr) return true
  let text = byteSlice(option.line, 0, option.colnr - 1)
  if (option.linenr != info.lnum || !pre.startsWith(text)) return true
  return false
}

export function getFollowPart(option: CompleteOption): string {
  let { colnr, line } = option
  let idx = characterIndex(line, colnr - 1)
  if (idx == line.length) return ''
  let part = line.slice(idx - line.length)
  return part.match(/^\S?[\w-]*/)[0]
}

export function getInput(document: Document, pre: string, asciiCharactersOnly: boolean): string {
  let len = 0
  for (let i = pre.length - 1; i >= 0; i--) {
    let ch = pre[i]
    let word = document.isWord(ch) && (asciiCharactersOnly ? ch.charCodeAt(0) < 255 : true)
    if (word) {
      len += 1
    } else {
      break
    }
  }
  return len == 0 ? '' : pre.slice(-len)
}

export function getSources(option: CompleteOption): ISource[] {
  let { source } = option
  if (source) return toArray(sources.getSource(source))
  return sources.getCompleteSources(option)
}

export function getPrependWord(document: Document, remain: string): string {
  let idx = 0
  for (let i = 0; i < remain.length; i++) {
    if (document.isWord(remain[i])) {
      idx = i + 1
    } else {
      break
    }
  }
  return idx == 0 ? '' : remain.slice(0, idx)
}

export function shouldIndent(indentkeys: string, pretext: string): boolean {
  if (!indentkeys || pretext.trim().includes(' ')) return false
  for (let part of indentkeys.split(',')) {
    if (part.indexOf('=') > -1) {
      let [pre, post] = part.split('=')
      let word = post.startsWith('~') ? post.slice(1) : post
      if (pretext.length < word.length ||
        (pretext.length > word.length && !/^\s/.test(pretext.slice(-word.length - 1)))) {
        continue
      }
      let matched = post.startsWith('~') ? pretext.toLowerCase().endsWith(word) : pretext.endsWith(word)
      if (!matched) {
        continue
      }
      if (pre == '') return true
      if (pre == '0' && /^\s*$/.test(pretext.slice(0, pretext.length - word.length))) {
        return true
      }
    }
  }
  return false
}

export function getValidWord(text: string, invalidChars: string[], start = 2): string | undefined {
  if (invalidChars.length === 0) return text
  for (let i = start; i < text.length; i++) {
    let c = text[i]
    if (invalidChars.includes(c)) {
      return text.slice(0, i)
    }
  }
  return text
}

export function positionHighlights(label: string, positions: number[], pre: number, line: number): HighlightItem[] {
  let hls: HighlightItem[] = []
  while (positions.length > 0) {
    let start = positions.shift()
    let end = start
    while (positions.length > 0) {
      let n = positions[0]
      if (n - end == 1) {
        end = n
        positions.shift()
      } else {
        break
      }
    }
    hls.push({
      hlGroup: 'CocPumSearch',
      lnum: line,
      colStart: pre + byteIndex(label, start),
      colEnd: pre + byteIndex(label, end + 1),
    })
  }
  return hls
}
