'use strict'
import unidecode from 'unidecode'
import { CompletionItem, CompletionItemKind, CompletionItemLabelDetails, CompletionItemTag, InsertReplaceEdit, InsertTextFormat, Range } from 'vscode-languageserver-protocol'
import { InsertChange } from '../events'
import Document from '../model/document'
import { SnippetParser } from '../snippets/parser'
import sources from '../sources'
import { CompleteDoneItem, CompleteOption, DurationCompleteItem, ExtendedCompleteItem, ISource, ItemDefaults } from '../types'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { isCompletionItem } from '../util/is'
import { toObject } from '../util/object'
import { byteIndex, byteSlice, characterIndex, includeLineBreak, toText } from '../util/string'

type PartialOption = Pick<CompleteOption, 'col' | 'colnr' | 'line'>
type OptionForWord = Pick<Readonly<CompleteOption>, 'line' | 'col' | 'position'>

export interface ConvertOption {
  itemDefaults?: ItemDefaults
  asciiMatch?: boolean
  prefix?: string
}

export function getKindText(kind: string | CompletionItemKind, kindMap: Map<CompletionItemKind, string>, defaultKindText: string): string {
  return typeof kind === 'number' ? kindMap.get(kind) ?? defaultKindText : kind
}

const highlightsMap = {
  [CompletionItemKind.Text]: 'CocSymbolText',
  [CompletionItemKind.Method]: 'CocSymbolMethod',
  [CompletionItemKind.Function]: 'CocSymbolFunction',
  [CompletionItemKind.Constructor]: 'CocSymbolConstructor',
  [CompletionItemKind.Field]: 'CocSymbolField',
  [CompletionItemKind.Variable]: 'CocSymbolVariable',
  [CompletionItemKind.Class]: 'CocSymbolClass',
  [CompletionItemKind.Interface]: 'CocSymbolInterface',
  [CompletionItemKind.Module]: 'CocSymbolModule',
  [CompletionItemKind.Property]: 'CocSymbolProperty',
  [CompletionItemKind.Unit]: 'CocSymbolUnit',
  [CompletionItemKind.Value]: 'CocSymbolValue',
  [CompletionItemKind.Enum]: 'CocSymbolEnum',
  [CompletionItemKind.Keyword]: 'CocSymbolKeyword',
  [CompletionItemKind.Snippet]: 'CocSymbolSnippet',
  [CompletionItemKind.Color]: 'CocSymbolColor',
  [CompletionItemKind.File]: 'CocSymbolFile',
  [CompletionItemKind.Reference]: 'CocSymbolReference',
  [CompletionItemKind.Folder]: 'CocSymbolFolder',
  [CompletionItemKind.EnumMember]: 'CocSymbolEnumMember',
  [CompletionItemKind.Constant]: 'CocSymbolConstant',
  [CompletionItemKind.Struct]: 'CocSymbolStruct',
  [CompletionItemKind.Event]: 'CocSymbolEvent',
  [CompletionItemKind.Operator]: 'CocSymbolOperator',
  [CompletionItemKind.TypeParameter]: 'CocSymbolTypeParameter',
}

export function getKindHighlight(kind: string | number): string {
  return typeof kind === 'number' ? highlightsMap[kind] ?? 'CocSymbolDefault' : 'CocSymbolDefault'
}

export function getResumeInput(option: PartialOption, pretext: string): string {
  let buf = Buffer.from(pretext, 'utf8')
  if (buf.length < option.colnr - 1) return null
  let pre = byteSlice(option.line, 0, option.colnr - 1)
  if (!pretext.startsWith(pre)) return null
  let remain = pretext.slice(pre.length)
  if (remain.includes(' ')) return null
  return buf.slice(option.col).toString('utf8')
}

export function checkIgnoreRegexps(ignoreRegexps: ReadonlyArray<string>, input: string): boolean {
  if (!ignoreRegexps || ignoreRegexps.length == 0 || input.length == 0) return false
  return ignoreRegexps.some(regexp => {
    try {
      return new RegExp(regexp).test(input)
    } catch (e) {
      return false
    }
  })
}

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

export function indentChanged(event: { word: string } | undefined, cursor: [number, number, string], line: string): boolean {
  if (!event) return false
  let pre = byteSlice(cursor[2], 0, cursor[1] - 1)
  if (pre.endsWith(event.word) && pre.match(/^\s*/)[0] != line.match(/^\s*/)[0]) {
    return true
  }
  return false
}

export function toCompleteDoneItem(item: DurationCompleteItem | undefined): CompleteDoneItem | {} {
  if (!item) return {}
  return {
    word: item.word,
    abbr: item.abbr,
    kind: item.kind,
    source: item.source,
    isSnippet: item.isSnippet === true,
    menu: item.menu ?? `[${item.source}]`,
    user_data: typeof item.user_data === 'string' ? item.user_data : `${item.source}:${item.index}`
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

export function highlightOffert<T extends { filterText: string, abbr: string }>(pre: number, item: T): number {
  let { filterText, abbr } = item
  let idx = abbr.indexOf(filterText)
  if (idx == -1) return -1
  let n = idx == 0 ? 0 : byteIndex(abbr, idx)
  return pre + n
}

export function emptLabelDetails(labelDetails: CompletionItemLabelDetails): boolean {
  if (!labelDetails) return true
  return !labelDetails.detail && !labelDetails.description
}

export function getWord(item: CompletionItem, isSnippet: boolean, opt: OptionForWord, itemDefaults: ItemDefaults): string {
  let { label, data, insertText, textEdit } = item
  if (data && typeof data.word === 'string') return data.word
  let newText: string = insertText ?? label
  let range: Range | undefined
  if (textEdit) {
    range = InsertReplaceEdit.is(textEdit) ? textEdit.insert : textEdit.range
    newText = textEdit.newText
  } else if (itemDefaults.editRange) {
    range = Range.is(itemDefaults.editRange) ? itemDefaults.editRange : itemDefaults.editRange.insert
  }
  if (range && range.start.line == range.end.line) {
    let { line, col, position } = opt
    let character = characterIndex(line, col)
    if (range.start.character < character) {
      let start = line.slice(range.start.character, character)
      if (start.length && newText.startsWith(start)) {
        newText = newText.slice(start.length)
      }
    } else if (range.start.character > character) {
      newText = line.slice(character, range.start.character) + newText
    }
    character = position.character
    if (range.end.character > character) {
      let end = line.slice(character, range.end.character)
      if (newText.endsWith(end)) {
        newText = newText.slice(0, - end.length)
      }
    }
  }
  let word = isSnippet ? (new SnippetParser()).text(newText) : newText
  return includeLineBreak(word) ? word.replace(/\n.*$/s, '') : word
}

export function convertCompletionItem(item: CompletionItem, index: number, source: string, priority: number, option: ConvertOption, opt: OptionForWord): DurationCompleteItem {
  const label = typeof item.label === 'string' ? item.label.trim() : toText(item.insertText)
  const itemDefaults = toObject(option.itemDefaults) as ItemDefaults
  let isSnippet = (item.insertTextFormat ?? itemDefaults.insertTextFormat) === InsertTextFormat.Snippet
  if (!isSnippet && !isFalsyOrEmpty(item.additionalTextEdits)) isSnippet = true
  let word = getWord(item, isSnippet, opt, itemDefaults)
  let obj: DurationCompleteItem = {
    word,
    abbr: label,
    kind: item.kind,
    detail: item.detail,
    sortText: item.sortText,
    filterText: item.filterText ?? word,
    preselect: item.preselect === true,
    deprecated: item.deprecated === true || item.tags?.includes(CompletionItemTag.Deprecated),
    isSnippet,
    index,
    source,
    priority,
    dup: item.data?.dup == 0 ? 0 : 1
  }
  if (!emptLabelDetails(item.labelDetails)) obj.labelDetails = item.labelDetails
  let { prefix } = option
  if (prefix) {
    // fix only when filterText exists
    if (item.filterText && !item.filterText.startsWith(prefix)) {
      obj.filterText = prefix + item.filterText
    }
    if (!item.textEdit && !obj.word.startsWith(prefix)) {
      // fix possible wrong word
      obj.word = `${prefix}${obj.word}`
    }
  }
  if (typeof item['score'] === 'number' && !obj.sortText) {
    obj.sortText = String.fromCodePoint(2 << 20 - Math.round(item['score']))
  }
  if (item.data?.optional && !obj.abbr.endsWith('?')) obj.abbr = obj.abbr + '?'
  // if (option.asciiMatch) obj.filterText = unidecode(obj.filterText)
  return obj
}

export function toDurationCompleteItem(item: ExtendedCompleteItem | CompletionItem, index: number, source: string, priority: number, option: ConvertOption, opt: OptionForWord): DurationCompleteItem {
  if (isCompletionItem(item)) return convertCompletionItem(item, index, source, priority, option, opt)
  const word = toText(item.word)
  const filterText = item.filterText ?? word
  return {
    word,
    abbr: item.abbr ?? word,
    filterText: option.asciiMatch ? unidecode(filterText) : filterText,
    source,
    priority,
    dup: item.dup,
    index,
    menu: item.menu,
    kind: item.kind,
    info: item.info,
    isSnippet: !!item.isSnippet,
    insertText: item.insertText,
    preselect: item.preselect,
    sortText: item.sortText,
    documentation: item.documentation,
    deprecated: item.deprecated,
    detail: item.detail,
    labelDetails: item.labelDetails
  }
}
