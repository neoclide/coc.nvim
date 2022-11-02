'use strict'
import { CancellationToken, CompletionItem, CompletionItemLabelDetails, CompletionTriggerKind, DocumentSelector, InsertReplaceEdit, InsertTextFormat, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../commands'
import { getCursorPosition } from '../core/ui'
import Document from '../model/document'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { CompleteOption, CompleteResult, Documentation, DurationCompleteItem, ISource, ItemDefaults, SourceType } from '../types'
import { waitImmediate } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { CancellationError } from '../util/errors'
import { isCompletionList } from '../util/is'
import { isEmpty } from '../util/object'
import { byteIndex, byteLength, byteSlice, characterIndex } from '../util/string'
import workspace from '../workspace'
import { createLogger } from '../logger'
const logger = createLogger('source-language')

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
  // Keeped Promise for resolve
  private resolving: WeakMap<CompletionItem, Promise<void>> = new WeakMap()
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

  public shouldCommit(item: DurationCompleteItem, character: string): boolean {
    let completeItem = this.completeItems[item.index]
    if (!completeItem) return false
    if (this.allCommitCharacters.includes(character)) return true
    let commitCharacters = completeItem.commitCharacters ?? (this.itemDefaults.commitCharacters ?? [])
    return commitCharacters.includes(character)
  }

  public async doComplete(option: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { triggerCharacter, input, bufnr, position } = option
    this.completeItems = []
    let triggerKind: CompletionTriggerKind = this.getTriggerKind(option)
    this.triggerContext = { lnum: position.line, character: position.character, line: option.line }
    let context: any = { triggerKind, option }
    if (triggerKind == CompletionTriggerKind.TriggerCharacter) context.triggerCharacter = triggerCharacter
    let textDocument = workspace.getDocument(bufnr).textDocument
    await waitImmediate()
    let result = await Promise.resolve(this.provider.provideCompletionItems(textDocument, position, token, context))
    if (!result || token.isCancellationRequested) return null
    let completeItems = Array.isArray(result) ? result : result.items
    if (!completeItems || completeItems.length == 0) return null
    let itemDefaults = this.itemDefaults = isCompletionList(result) ? result.itemDefaults ?? {} : {}
    this.completeItems = completeItems
    let startcol = getStartColumn(option.line, completeItems, this.itemDefaults)
    // gopls returns bad start position, but it should includes start position
    if (startcol > option.col && input.length > 0) {
      startcol = option.col
      let character = characterIndex(option.line, startcol)
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
    let prefix: string | undefined
    let isIncomplete = isCompletionList(result) ? result.isIncomplete == true : false
    if (startcol == null && input.length > 0 && this.triggerCharacters.includes(option.triggerCharacter)) {
      if (!completeItems.every(item => (item.insertText ?? item.label).startsWith(option.input))) {
        startcol = option.col + byteLength(option.input)
      }
    }
    if (typeof startcol === 'number' && startcol < option.col) {
      prefix = startcol < option.col ? byteSlice(option.line, startcol, option.col) : ''
      option.col = startcol
    }
    return { startcol, isIncomplete, items: completeItems, prefix, itemDefaults }
  }

  public onCompleteResolve(item: DurationCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let { index } = item
    let completeItem = this.completeItems[index]
    if (!completeItem) return Promise.resolve()
    let hasResolve = typeof this.provider.resolveCompletionItem === 'function'
    if (!hasResolve) {
      this.addDocumentation(item, completeItem, opt.filetype)
      return Promise.resolve()
    }
    let promise = this.resolving.get(completeItem)
    if (promise) return promise
    promise = new Promise(async (resolve, reject) => {
      let disposable = token.onCancellationRequested(() => {
        this.resolving.delete(completeItem)
        reject(new CancellationError())
      })
      try {
        let resolved = await Promise.resolve(this.provider.resolveCompletionItem(completeItem, token))
        disposable.dispose()
        if (!token.isCancellationRequested) {
          if (!resolved) {
            this.resolving.delete(completeItem)
          } else {
            Object.assign(completeItem, resolved)
            this.addDocumentation(item, completeItem, opt.filetype)
          }
        }
        resolve()
      } catch (e) {
        reject(e)
      }
    })
    this.resolving.set(completeItem, promise)
    return promise
  }

  private addDocumentation(item: DurationCompleteItem, completeItem: CompletionItem, filetype: string): void {
    let { documentation } = completeItem
    let docs: Documentation[] = []
    if (!item.detailRendered) {
      let doc = getDetail(completeItem, filetype)
      if (doc) docs.push(doc)
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

  public async onCompleteDone(vimItem: DurationCompleteItem, opt: CompleteOption, snippetSupport: boolean): Promise<void> {
    let item = this.completeItems[vimItem.index]
    if (!item) return
    let doc = workspace.getDocument(opt.bufnr)
    await doc.patchChange(true)
    let additionalEdits = !isFalsyOrEmpty(item.additionalTextEdits)
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
    let insertTextFormat = item.insertTextFormat ?? this.itemDefaults?.insertTextFormat
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

export function fixIndent(line: string, currline: string, range: Range): number {
  let oldIndent = line.match(/^\s*/)[0]
  let newIndent = currline.match(/^\s*/)[0]
  if (oldIndent === newIndent) return 0
  let d = newIndent.length - oldIndent.length
  range.start.character += d
  range.end.character += d
  return d
}

export function getDetail(item: CompletionItem, filetype: string): { filetype: string, content: string } | undefined {
  const { detail, labelDetails, label } = item
  if (!isEmpty(labelDetails)) {
    let content = (labelDetails.detail ?? '') + (labelDetails.description ? ` ${labelDetails.description}` : '')
    return { filetype: 'txt', content }
  }
  if (detail && detail !== label) {
    let isText = /^[\w-\s.,\t\n]+$/.test(detail)
    return { filetype: isText ? 'txt' : filetype, content: detail }
  }
  return undefined
}
