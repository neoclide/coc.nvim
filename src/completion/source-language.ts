'use strict'
import type { DocumentSelector } from 'vscode-languageserver-protocol'
import { CompletionItem, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import { getReplaceRange, isSnippetItem } from './util'
import { getLineAndPosition } from '../core/ui'
import { createLogger } from '../logger'
import Document from '../model/document'
import { CompletionItemProvider } from '../provider'
import snippetManager from '../snippets/manager'
import { Documentation, UltiSnippetOption } from '../types'
import { CompleteOption, CompleteResult, DurationCompleteItem, ISource, ItemDefaults, SourceType } from './types'
import { pariedCharacters, waitImmediate } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { CancellationError } from '../util/errors'
import { isCompletionList } from '../util/is'
import { isEmpty, toObject } from '../util/object'
import { CancellationToken, CompletionTriggerKind } from '../util/protocol'
import { characterIndex } from '../util/string'
import workspace from '../workspace'
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
    let commitCharacters = toArray(completeItem.commitCharacters ?? this.itemDefaults.commitCharacters)
    return commitCharacters.includes(character)
  }

  public async doComplete(option: CompleteOption, token: CancellationToken): Promise<CompleteResult | null> {
    let { triggerCharacter, bufnr, position } = option
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
    let itemDefaults = this.itemDefaults = toObject(result['itemDefaults'])
    this.completeItems = completeItems
    let isIncomplete = isCompletionList(result) ? result.isIncomplete === true : false
    return { isIncomplete, items: completeItems, itemDefaults }
  }

  public onCompleteResolve(item: DurationCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let { index } = item
    let completeItem = this.completeItems[index]
    if (!completeItem) return Promise.resolve()
    let hasResolve = typeof this.provider.resolveCompletionItem === 'function'
    if (!hasResolve) {
      addDocumentation(item, completeItem, opt.filetype)
      return Promise.resolve()
    }
    let promise = this.resolving.get(completeItem)
    if (promise) return promise
    let invalid = false
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
            invalid = true
            this.resolving.delete(completeItem)
          } else {
            Object.assign(completeItem, resolved)
            addDocumentation(item, completeItem, opt.filetype)
          }
        }
        resolve()
      } catch (e) {
        invalid = true
        this.resolving.delete(completeItem)
        reject(e)
      }
    })
    if (!invalid) this.resolving.set(completeItem, promise)
    return promise
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
    let isSnippet = await this.applyTextEdit(doc, additionalEdits, item, opt, snippetSupport)
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

  private async applyTextEdit(doc: Document, additionalEdits: boolean, item: CompletionItem, option: CompleteOption, snippetSupport: boolean): Promise<boolean> {
    let { linenr, col } = option
    let { character, line } = this.triggerContext
    let pos = await getLineAndPosition(workspace.nvim)
    if (pos.line != linenr - 1) return
    let { textEdit, insertText, label } = item
    let range = getReplaceRange(item, this.itemDefaults)
    if (!range) {
      // create default replace range
      let end = character + option.followWord.length
      range = Range.create(pos.line, characterIndex(line, col), pos.line, end)
    }
    // replace range must contains cursor position.
    if (range.end.character < character) range.end.character = character
    let newText = textEdit ? textEdit.newText : insertText ?? label
    // adjust range by indent
    let indentCount = fixIndent(line, pos.text, range)
    // cursor moved count
    let delta = pos.character - character - indentCount
    // fix range by count cursor moved to replace insert word on complete done.
    if (delta !== 0) range.end.character += delta
    let next = pos.text[range.end.character]
    if (next && newText.endsWith(next) && pariedCharacters.get(newText[0]) === next) {
      range.end.character += 1
    }
    if (snippetSupport !== false && isSnippetItem(item, this.itemDefaults)) {
      let opts = getUltisnipOption(item)
      let insertTextMode = item.insertTextMode ?? this.itemDefaults.insertTextMode
      return await snippetManager.insertSnippet(newText, !additionalEdits, range, insertTextMode, opts)
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

export function getUltisnipOption(item: CompletionItem): UltiSnippetOption | undefined {
  let opts = item.data?.ultisnip === true ? {} : item.data?.ultisnip
  return opts ? opts : undefined
}

export function addDocumentation(item: DurationCompleteItem, completeItem: CompletionItem, filetype: string): void {
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
