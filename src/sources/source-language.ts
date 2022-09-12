'use strict'
import { CancellationToken, CompletionItem, CompletionItemTag, CompletionTriggerKind, DocumentSelector, InsertReplaceEdit, InsertTextFormat, InsertTextMode, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../commands'
import { getCursorPosition } from '../core/ui'
import Document from '../model/document'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption, CompleteResult, Documentation, ExtendedCompleteItem, ISource, SourceType } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { isCompletionList } from '../util/is'
import { byteIndex, byteLength, byteSlice, characterIndex } from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('source-language')

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

interface TriggerContext {
  line: string
  lnum: number
  character: number
}

export default class LanguageSource implements ISource {
  public readonly sourceType = SourceType.Service
  private _enabled = true
  private completeItems: CompletionItem[] = []
  private itemDefaults: ItemDefaults = {}
  // cursor position on trigger
  private triggerContext: TriggerContext | undefined
  constructor(
    public readonly name: string,
    public readonly shortcut: string,
    private provider: CompletionItemProvider,
    public readonly documentSelector: DocumentSelector,
    public readonly triggerCharacters: string[],
    public readonly allCommitCharacters: string[],
    public readonly priority: number | undefined
  ) {
  }

  public get enable(): boolean {
    return this._enabled
  }

  public toggle(): void {
    this._enabled = !this._enabled
  }

  public shouldCommit(item: ExtendedCompleteItem, character: string): boolean {
    let completeItem = this.completeItems[item.index]
    if (!completeItem) return false
    if (this.allCommitCharacters.includes(character)) return true
    let commitCharacters = completeItem.commitCharacters ?? (this.itemDefaults.commitCharacters ?? [])
    return commitCharacters.includes(character)
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { triggerCharacter, input, bufnr, position } = opt
    this.completeItems = []
    let triggerKind: CompletionTriggerKind = this.getTriggerKind(opt)
    this.triggerContext = { lnum: position.line, character: position.character, line: opt.line }
    let context: any = { triggerKind, option: opt }
    if (triggerKind == CompletionTriggerKind.TriggerCharacter) context.triggerCharacter = triggerCharacter
    let doc = workspace.getDocument(bufnr)
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
    } else if (detail && !item.detailRendered && detail != item.abbr) {
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

  public async onCompleteDone(vimItem: ExtendedCompleteItem, opt: CompleteOption, snippetSupport: boolean): Promise<void> {
    let item = this.completeItems[vimItem.index]
    if (!item) return
    let doc = workspace.getDocument(opt.bufnr)
    await doc.patchChange(true)
    let additionalEdits = Array.isArray(item.additionalTextEdits) && item.additionalTextEdits.length > 0
    if (additionalEdits) {
      let shouldCancel = await snippetManager.editsInsideSnippet(item.additionalTextEdits)
      if (shouldCancel) snippetManager.cancel()
    }
    let version = doc.version
    let isSnippet = false
    if (!snippetSupport) {
      logger.info('Snippets support is disabled, no textEdit applied.')
    } else {
      isSnippet = await this.applyTextEdit(doc, additionalEdits, item, opt)
    }
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

  private async applyTextEdit(doc: Document, additionalEdits: boolean, item: CompletionItem, option: CompleteOption): Promise<boolean> {
    let { linenr, col } = option
    let { character, line } = this.triggerContext
    let pos = await getCursorPosition(workspace.nvim)
    if (pos.line != linenr - 1) return
    let range: Range | undefined
    let { textEdit, insertText, label } = item
    if (textEdit) {
      range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    } else {
      let editRange = this.itemDefaults.editRange
      if (editRange) {
        range = Range.is(editRange) ? editRange : editRange.replace
      } else if (item.insertText) {
        range = Range.create(pos.line, characterIndex(line, col), pos.line, character)
      }
    }
    if (!range) return false
    // attempt to fix range from textEdit, range should include trigger position
    if (range.end.character < character) range.end.character = character
    let currline = doc.getline(linenr - 1, false)
    let newText = textEdit ? textEdit.newText : insertText ?? label
    // adjust range by indent
    let indentCount = fixIndent(line, currline, range)
    // cursor moved count
    let delta = pos.character - character - indentCount
    // fix range by count cursor moved to replace insert word on complete done.
    if (delta !== 0) range.end.character += delta
    let isSnippet = this.isSnippetItem(item)
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
    let label = typeof item.label === 'string' ? item.label.trim() : item.insertText ?? ''
    let isSnippet = this.isSnippetItem(item)
    let obj: ExtendedCompleteItem = {
      word: getWord(item, isSnippet, opt, this.itemDefaults),
      abbr: label,
      kind: item.kind,
      detail: item.detail,
      additionalEdits: item.additionalTextEdits != null && item.additionalTextEdits.length > 0,
      sortText: item.sortText,
      filterText: item.filterText ?? label,
      preselect: item.preselect === true,
      deprecated: item.deprecated === true || item.tags?.includes(CompletionItemTag.Deprecated),
      isSnippet,
      labelDetails: item.labelDetails,
      dup: item.data?.dup == 0 ? 0 : 1
    }
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
    if (typeof item['score'] === 'number') obj.sourceScore = item['score']
    if (item.data?.optional && !obj.abbr.endsWith('?')) obj.abbr = obj.abbr + '?'
    return obj
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

export function getWord(item: CompletionItem, isSnippet: boolean, opt: CompleteOption, itemDefaults: ItemDefaults): string {
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
  return word.indexOf('\n') === -1 ? word : word.replace(/\n.*$/s, '')
}

export function fixIndent(line: string, currline: string, range: Range): number {
  let oldIndent = line.match(/^\s*/)[0]
  let newIndent = currline.match(/^\s*/)[0]
  if (oldIndent === newIndent) return 0
  let d = newIndent.length - oldIndent.length
  range.start.character += d
  range.end.character += d
  return d
}
