'use strict'
import { CancellationToken, CompletionItem, CompletionItemKind, CompletionItemTag, CompletionTriggerKind, DocumentSelector, InsertReplaceEdit, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../commands'
import Document from '../model/document'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { SnippetParser } from '../snippets/parser'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, SourceType } from '../types'
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

export default class LanguageSource implements ISource {
  public priority: number
  public sourceType: SourceType.Service
  private _enabled = true
  private completeItems: CompletionItem[] = []
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
    let commitCharacters = [...this.allCommitCharacters, ...(completeItem.commitCharacters || [])]
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
    this.completeItems = completeItems
    let startcol = getStartColumn(opt.line, completeItems)
    let option: CompleteOption = Object.assign({}, opt)
    let prefix: string
    let isIncomplete = typeof result['isIncomplete'] === 'boolean' ? result['isIncomplete'] : false
    if (startcol == null && input.length > 0 && this.triggerCharacters.includes(opt.triggerCharacter)) {
      if (!completeItems.every(item => (item.insertText ?? item.label).startsWith(opt.input))) {
        startcol = opt.col + byteLength(opt.input)
      }
    }
    if (startcol != null) {
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
    let { index } = item
    let completeItem = this.completeItems[index]
    if (!completeItem || item.resolved) return
    let hasResolve = typeof this.provider.resolveCompletionItem === 'function'
    if (hasResolve) {
      let resolved = await Promise.resolve(this.provider.resolveCompletionItem(completeItem, token))
      if (token.isCancellationRequested || !resolved) return
      Object.assign(completeItem, resolved)
    }
    item.resolved = true
    let { documentation, detail } = completeItem
    if (!documentation && !detail) return
    let docs = []
    if (detail && !item.detailShown && detail != item.word) {
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

  private async applyTextEdit(doc: Document, additionalEdits: boolean, item: CompletionItem, word: string, option: CompleteOption): Promise<boolean> {
    let { line, linenr, colnr, col } = option
    let pos = await window.getCursorPosition()
    if (pos.line != linenr - 1) return
    let { textEdit } = item
    let currline = doc.getline(linenr - 1)
    // before CompleteDone
    let beginIdx = characterIndex(line, colnr - 1)
    if (!textEdit && item.insertText) {
      textEdit = {
        range: Range.create(pos.line, characterIndex(line, col), pos.line, beginIdx),
        newText: item.insertText
      }
    }
    if (!textEdit) return false
    let newText = textEdit.newText
    let range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
    // adjust range by indent
    let n = fixIndent(line, currline, range)
    if (n) beginIdx += n
    // attempt to fix range from textEdit, range should include trigger position
    if (range.end.character < beginIdx) range.end.character = beginIdx
    // fix range by count cursor moved to replace insernt word on complete done.
    if (pos.character > beginIdx) range.end.character += pos.character - beginIdx
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
    if (isSnippet && this.completeConfig.snippetsSupport === false) {
      // could be wrong, but maybe best we can do.
      isSnippet = false
      newText = word
    }
    if (isSnippet) {
      let opts = item.data?.ultisnip === true ? {} : item.data?.ultisnip
      return await snippetManager.insertSnippet(newText, !additionalEdits, range, item.insertTextMode, opts ? opts : undefined)
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
    let isSnippet = item.insertTextFormat === InsertTextFormat.Snippet || hasAdditionalEdit
    let label = typeof item.label === 'string' ? item.label.trim() : item.insertText ?? ''
    let obj: ExtendedCompleteItem = {
      word: getWord(item, opt, invalidInsertCharacters),
      abbr: label,
      kind: getKindString(item.kind, labels, defaultKindText),
      kindHighlight: highlightsMap[item.kind] ?? 'CocSymbolDefault',
      sortText: item.sortText ?? null,
      sourceScore: item['score'] ?? null,
      filterText: item.filterText ?? label,
      preselect: item.preselect === true,
      deprecated: item.deprecated === true || item.tags?.includes(CompletionItemTag.Deprecated),
      isSnippet,
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
    if (obj.word == '') obj.empty = 1
    if (detailField == 'abbr' && item.detail) {
      let detail = item.detail.replace(/\r?\n\s*/g, ' ')
      if (byteLength(obj.abbr + detail) < detailMaxLength - 3) {
        obj.abbr = `${obj.abbr} - ${detail}`
        obj.detailShown = 1
      }
    }
    if (item.kind == CompletionItemKind.Folder && !obj.abbr.endsWith('/')) obj.abbr = obj.abbr + '/'
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

/*
 * Check new startcol by check start characters.
 */
export function getStartColumn(line: string, items: CompletionItem[]): number | undefined {
  let first = items[0]
  if (first.textEdit == null) return undefined
  let range = InsertReplaceEdit.is(first.textEdit) ? first.textEdit.replace : first.textEdit.range
  let { character } = range.start
  for (let i = 1; i < Math.min(10, items.length); i++) {
    let o = items[i]
    if (!o.textEdit) return undefined
    let r = InsertReplaceEdit.is(o.textEdit) ? o.textEdit.replace : o.textEdit.range
    if (r.start.character !== character) return undefined
  }
  return byteIndex(line, character)
}

export function getKindString(kind: CompletionItemKind, map: Map<CompletionItemKind, string>, defaultValue = ''): string {
  return map.get(kind) || defaultValue
}

export function getWord(item: CompletionItem, opt: CompleteOption, invalidInsertCharacters: string[]): string {
  let { label, data, insertTextFormat, insertText, textEdit } = item
  let word: string
  let newText: string
  if (data && typeof data.word === 'string') return data.word
  if (textEdit) {
    let range = InsertReplaceEdit.is(textEdit) ? textEdit.replace : textEdit.range
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
  } else if (insertText) {
    newText = insertText
  }
  if (insertTextFormat == InsertTextFormat.Snippet && newText && newText.includes('$')) {
    let parser = new SnippetParser()
    let text = parser.text(newText)
    word = text ? getValidWord(text, invalidInsertCharacters) : label
  } else {
    word = getValidWord(newText, invalidInsertCharacters) ?? label
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
