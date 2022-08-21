'use strict'
import { CancellationToken, CompletionItem, CompletionItemKind, CompletionItemTag, CompletionList, CompletionTriggerKind, DocumentSelector, InsertReplaceEdit, InsertTextFormat, InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../commands'
import Document from '../model/document'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption, CompleteResult, Documentation, ExtendedCompleteItem, ISource, SourceType } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteIndex, byteLength, byteSlice, characterIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
const logger = require('../util/logger')('source-language')

export interface CompleteConfig {
  labels: Map<CompletionItemKind, string>
  snippetsSupport: boolean
  defaultKindText: string
  priority: number
  detailMaxLength: number
  detailField: string
  invalidInsertCharacters: string[]
}

export interface ItemDefaults {
  commitCharacters?: string[]
  editRange?: Range | {
    insert: Range
    replace: Range
  }
  insertTextFormat?: InsertTextFormat
  insertTextMode?: InsertTextMode
  data?: any
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

function isCompletionList(obj: any): obj is CompletionList {
  return !Array.isArray(obj) && Array.isArray(obj.items)
}

export default class LanguageSource implements ISource {
  public priority: number
  public sourceType: SourceType.Service
  private _enabled = true
  private completeItems: CompletionItem[] = []
  private itemDefaults: ItemDefaults = {}
  constructor(
    public readonly name: string,
    public readonly shortcut: string,
    private provider: CompletionItemProvider,
    public readonly documentSelector: DocumentSelector,
    public readonly triggerCharacters: string[],
    public readonly allCommitCharacters: string[],
    priority: number | undefined,
    private readonly completeConfig: CompleteConfig,
  ) {
    this.priority = typeof priority === 'number' ? priority : completeConfig.priority
  }

  public get enable(): boolean {
    return this._enabled
  }

  public toggle(): void {
    this._enabled = !this._enabled
  }

  public shouldCommit?(item: ExtendedCompleteItem, character: string): boolean {
    let completeItem = this.completeItems[item.index]
    if (!completeItem) return false
    if (this.allCommitCharacters.includes(character)) return true
    let commitCharacters = completeItem.commitCharacters ?? (this.itemDefaults.commitCharacters ?? [])
    return commitCharacters.includes(character)
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { triggerCharacter, input, bufnr } = opt
    this.completeItems = []
    let triggerKind: CompletionTriggerKind = this.getTriggerKind(opt)
    let position = this.getPosition(opt)
    let context: any = { triggerKind, option: opt }
    if (triggerKind == CompletionTriggerKind.TriggerCharacter) context.triggerCharacter = triggerCharacter
    let doc = workspace.getAttachedDocument(bufnr)
    let result = await Promise.resolve(this.provider.provideCompletionItems(doc.textDocument, position, token, context))
    if (!result || token.isCancellationRequested) return null
    let completeItems = Array.isArray(result) ? result : result.items
    if (!completeItems || completeItems.length == 0) return null
    this.itemDefaults = isCompletionList(result) ? result.itemDefaults ?? {} : {}
    this.completeItems = completeItems
    let option: CompleteOption = Object.assign({}, opt)
    let startcol = getStartColumn(opt.line, completeItems, this.itemDefaults)
    // gopls returns bad start position, but it should includes start position
    if (startcol > opt.col && input.length > 0) {
      startcol = opt.col
      let character = characterIndex(opt.line, startcol)
      // fix range.start to include position
      completeItems.forEach(item => {
        let { textEdit } = item
        if (TextEdit.is(textEdit)) {
          textEdit.range.start.character = character
        } else if (InsertReplaceEdit.is(textEdit)) {
          textEdit.replace.start.character = character
          textEdit.insert.start.character = character
        }
      })
    }
    let prefix: string
    let isIncomplete = isCompletionList(result) ? result.isIncomplete == true : false
    if (startcol == null && input.length > 0 && this.triggerCharacters.includes(opt.triggerCharacter)) {
      if (!completeItems.every(item => (item.insertText ?? item.label).startsWith(opt.input))) {
        startcol = opt.col + byteLength(opt.input)
      }
    }
    if (typeof startcol === 'number' && startcol < option.col) {
      prefix = startcol < option.col ? byteSlice(opt.line, startcol, option.col) : ''
      option.col = startcol
    }
    let items: ExtendedCompleteItem[] = completeItems.map((o, index) => {
      let item = this.convertVimCompleteItem(o, option, prefix)
      item.index = index
      return item
    })
    return { startcol, isIncomplete, items }
  }

  public async onCompleteResolve(item: ExtendedCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let { index, detailRendered } = item
    let completeItem = this.completeItems[index]
    if (!completeItem || item.resolved) return
    let hasResolve = typeof this.provider.resolveCompletionItem === 'function'
    if (hasResolve) {
      let resolved = await Promise.resolve(this.provider.resolveCompletionItem(completeItem, token))
      if (token.isCancellationRequested || !resolved) return
      Object.assign(completeItem, resolved)
    }
    item.resolved = true
    let { documentation, detail, labelDetails } = completeItem
    let docs: Documentation[] = []
    if (labelDetails && !detailRendered) {
      let content = (labelDetails.detail ?? '') + (labelDetails.description ? ` ${labelDetails.description}` : '')
      docs.push({ filetype: 'txt', content })
    } else if (detail && !item.detailShown && detail != item.word) {
      detail = detail.replace(/\n\s*/g, ' ')
      if (detail.length) {
        let isText = /^[\w-\s.,\t\n]+$/.test(detail)
        docs.push({ filetype: isText ? 'txt' : opt.filetype, content: detail })
      }
    }
    if (documentation) {
      if (typeof documentation == 'string') {
        docs.push({ filetype: 'txt', content: documentation })
      } else if (documentation.value) {
        docs.push({
          filetype: documentation.kind == 'markdown' ? 'markdown' : 'txt',
          content: documentation.value
        })
      }
    }
    if (docs.length == 0) return
    item.documentation = docs
  }

  public async onCompleteDone(vimItem: ExtendedCompleteItem, opt: CompleteOption): Promise<void> {
    let item = this.completeItems[vimItem.index]
    if (!item) return
    if (typeof vimItem.line === 'string') Object.assign(opt, { line: vimItem.line })
    let doc = workspace.getAttachedDocument(opt.bufnr)
    await doc.patchChange(true)
    let additionalEdits = Array.isArray(item.additionalTextEdits) && item.additionalTextEdits.length > 0
    if (additionalEdits) {
      let shouldCancel = await snippetManager.editsInsideSnippet(item.additionalTextEdits)
      if (shouldCancel) snippetManager.cancel()
    }
    let version = doc.version
    let isSnippet = await this.applyTextEdit(doc, additionalEdits, item, vimItem.word, opt)
    if (additionalEdits) {
      // move cursor after edit
      await doc.applyEdits(item.additionalTextEdits, doc.version != version, !isSnippet)
      if (isSnippet) await snippetManager.selectCurrentPlaceholder()
    }
    if (item.command) {
      if (commands.has(item.command.command)) {
        await commands.execute(item.command)
      } else {
        logger.warn(`Command "${item.command.command}" not registered to coc.nvim`)
      }
    }
  }

  private isSnippetItem(item: CompletionItem): boolean {
    let insertTextFormat = item.insertTextFormat ?? this.itemDefaults.insertTextFormat
    return insertTextFormat === InsertTextFormat.Snippet
  }

  private async applyTextEdit(doc: Document, additionalEdits: boolean, item: CompletionItem, word: string, option: CompleteOption): Promise<boolean> {
    let { line, linenr, colnr, col } = option
    let pos = await window.getCursorPosition()
    if (pos.line != linenr - 1) return
    let range: Range | undefined
    let { textEdit, insertText, label } = item
    let beginIdx = characterIndex(line, colnr - 1)
    if (textEdit) {
      range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    } else {
      let editRange = this.itemDefaults.editRange
      if (editRange) {
        range = Range.is(editRange) ? editRange : editRange.replace
      } else if (item.insertText) {
        range = Range.create(pos.line, characterIndex(line, col), pos.line, beginIdx)
      }
    }
    if (!range) return false
    let currline = doc.getline(linenr - 1)
    let newText = textEdit ? textEdit.newText : insertText ?? label
    // adjust range by indent
    let n = fixIndent(line, currline, range)
    if (n) beginIdx += n
    // attempt to fix range from textEdit, range should include trigger position
    if (range.end.character < beginIdx) range.end.character = beginIdx
    // fix range by count cursor moved to replace insert word on complete done.
    if (pos.character > beginIdx) range.end.character += pos.character - beginIdx
    let isSnippet = this.isSnippetItem(item)
    if (isSnippet && this.completeConfig.snippetsSupport === false) {
      // could be wrong, but maybe best we can do.
      isSnippet = false
      newText = word
    }
    if (isSnippet) {
      let opts = item.data?.ultisnip === true ? {} : item.data?.ultisnip
      let insertTextMode = item.insertTextMode ?? this.itemDefaults.insertTextMode
      return await snippetManager.insertSnippet(newText, !additionalEdits, range, insertTextMode, opts ? opts : undefined)
    }
    await doc.applyEdits([TextEdit.replace(range, newText)], false, pos)
    return false
  }

  private getTriggerKind(opt: CompleteOption): CompletionTriggerKind {
    let { triggerCharacters } = this
    let isTrigger = triggerCharacters.includes(opt.triggerCharacter)
    let triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoked
    if (opt.triggerForInComplete) {
      triggerKind = CompletionTriggerKind.TriggerForIncompleteCompletions
    } else if (isTrigger) {
      triggerKind = CompletionTriggerKind.TriggerCharacter
    }
    return triggerKind
  }

  private convertVimCompleteItem(item: CompletionItem, opt: CompleteOption, prefix: string): ExtendedCompleteItem {
    let { detailMaxLength, detailField, invalidInsertCharacters, labels, defaultKindText } = this.completeConfig
    let hasAdditionalEdit = item.additionalTextEdits != null && item.additionalTextEdits.length > 0
    let isSnippet = this.isSnippetItem(item) || hasAdditionalEdit
    let label = typeof item.label === 'string' ? item.label.trim() : item.insertText ?? ''
    let obj: ExtendedCompleteItem = {
      word: getWord(item, opt, invalidInsertCharacters, this.itemDefaults),
      abbr: label,
      kind: getKindString(item.kind, labels, defaultKindText),
      kindHighlight: highlightsMap[item.kind] ?? 'CocSymbolDefault',
      sortText: item.sortText ?? null,
      sourceScore: item['score'] ?? null,
      filterText: item.filterText ?? label,
      preselect: item.preselect === true,
      deprecated: item.deprecated === true || item.tags?.includes(CompletionItemTag.Deprecated),
      isSnippet,
      labelDetails: item.labelDetails,
      dup: item.data?.dup == 0 ? 0 : 1
    }
    obj.line = opt.line
    if (prefix) {
      if (!obj.filterText.startsWith(prefix)) {
        if (item.textEdit && fuzzyMatch(getCharCodes(prefix), item.textEdit.newText)) {
          obj.filterText = item.textEdit.newText.replace(/\r?\n/g, '')
        }
      }
      if (!item.textEdit && !obj.word.startsWith(prefix)) {
        // fix possible wrong word
        obj.word = `${prefix}${obj.word}`
      }
    }
    if (detailField == 'abbr' && item.detail) {
      let detail = item.detail.replace(/\r?\n\s*/g, ' ')
      if (byteLength(obj.abbr + detail) < detailMaxLength - 3) {
        obj.abbr = `${obj.abbr} - ${detail}`
        obj.detailShown = 1
      }
    }
    if (item.kind === CompletionItemKind.Folder && !obj.abbr.endsWith('/')) obj.abbr = obj.abbr + '/'
    if (item.data?.optional && !obj.abbr.endsWith('?')) obj.abbr = obj.abbr + '?'
    return obj
  }

  private getPosition(opt: CompleteOption): Position {
    let { line, linenr, colnr } = opt
    let part = byteSlice(line, 0, colnr - 1)
    return {
      line: linenr - 1,
      character: part.length
    }
  }
}

export function getRange(item: CompletionItem | undefined, itemDefaults?: ItemDefaults): Range | undefined {
  if (!item) return undefined
  if (item.textEdit) {
    let range = InsertReplaceEdit.is(item.textEdit) ? item.textEdit.replace : item.textEdit.range
    if (range) return range
  }
  let editRange = itemDefaults?.editRange
  if (!editRange) return undefined
  return Range.is(editRange) ? editRange : editRange.replace
}

/*
 * Check new startcol by check start characters.
 */
export function getStartColumn(line: string, items: CompletionItem[], itemDefaults?: ItemDefaults): number | undefined {
  let first = items[0]
  let range = getRange(first, itemDefaults)
  if (range === undefined) return undefined
  let { character } = range.start
  for (let i = 1; i < Math.min(10, items.length); i++) {
    let o = items[i]
    if (!o.textEdit) return undefined
    let r = getRange(o, itemDefaults)
    if (!r || r.start.character !== character) return undefined
  }
  return byteIndex(line, range.start.character)
}

export function getKindString(kind: CompletionItemKind, map: Map<CompletionItemKind, string>, defaultValue = ''): string {
  return map.get(kind) || defaultValue
}

export function getWord(item: CompletionItem, opt: CompleteOption, invalidInsertCharacters: string[], itemDefaults: ItemDefaults): string {
  let { label, data, insertTextFormat, insertText, textEdit } = item
  let isSnippet = (insertTextFormat ?? itemDefaults.insertTextFormat) === InsertTextFormat.Snippet
  let word: string
  let newText: string = insertText
  if (data && typeof data.word === 'string') return data.word
  let range: Range | undefined
  if (textEdit) {
    range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    newText = textEdit.newText
  } else if (itemDefaults.editRange) {
    let editRange = itemDefaults.editRange
    range = Range.is(editRange) ? editRange : editRange.replace
    newText = insertText ?? label
  }
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
  if (isSnippet && newText) {
    let parser = new SnippetParser()
    let text = parser.text(newText)
    word = text ? getValidWord(text, invalidInsertCharacters) : label
  } else {
    word = getValidWord(newText, ['\n', '\r']) ?? label
  }
  return word ?? ''
}

export function getValidWord(text: string, invalidChars: string[], start = 2): string | undefined {
  if (text == null) return undefined
  if (invalidChars.length === 0) return text
  for (let i = start; i < text.length; i++) {
    let c = text[i]
    if (invalidChars.includes(c)) {
      return text.slice(0, i)
    }
  }
  return text
}

export function fixIndent(line: string, currline: string, range: Range): number {
  let oldIndent = line.match(/^\s*/)[0]
  let newIndent = currline.match(/^\s*/)[0]
  if (oldIndent == newIndent) return
  let d = newIndent.length - oldIndent.length
  range.start.character += d
  range.end.character += d
  return d
}
