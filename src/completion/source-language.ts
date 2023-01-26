'use strict'
import { CompletionItem, InsertReplaceEdit, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import { getLineAndPosition } from '../core/ui'
import { createLogger } from '../logger'
import Document from '../model/document'
import { CompletionItemProvider, DocumentSelector } from '../provider'
import snippetManager from '../snippets/manager'
import { UltiSnippetOption } from '../types'
import { pariedCharacters, waitImmediate } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { CancellationError } from '../util/errors'
import * as Is from '../util/is'
import { toObject } from '../util/object'
import { CancellationToken, CompletionTriggerKind } from '../util/protocol'
import { characterIndex } from '../util/string'
import workspace from '../workspace'
import { CompleteDoneOption, CompleteOption, CompleteResult, InsertMode, ISource, ItemDefaults, SourceType } from './types'
import { getReplaceRange, isSnippetItem } from './util'
const logger = createLogger('source-language')

interface TriggerContext {
  line: string
  lnum: number
  character: number
}

export default class LanguageSource implements ISource<CompletionItem> {
  public readonly sourceType = SourceType.Service
  private _enabled = true
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

  public shouldCommit(item: CompletionItem, character: string): boolean {
    if (this.allCommitCharacters.includes(character)) return true
    let commitCharacters = toArray(item.commitCharacters ?? this.itemDefaults.commitCharacters)
    return commitCharacters.includes(character)
  }

  public async doComplete(option: CompleteOption, token: CancellationToken): Promise<CompleteResult<CompletionItem> | null> {
    let { triggerCharacter, bufnr, position } = option
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
    let isIncomplete = Is.isCompletionList(result) ? result.isIncomplete === true : false
    return { isIncomplete, items: completeItems, itemDefaults }
  }

  public onCompleteResolve(item: CompletionItem, opt: CompleteOption | undefined, token: CancellationToken): Promise<void> | void {
    let hasResolve = Is.func(this.provider.resolveCompletionItem)
    if (!hasResolve) return
    let promise = this.resolving.get(item)
    if (promise) return promise
    let invalid = false
    promise = new Promise(async (resolve, reject) => {
      let disposable = token.onCancellationRequested(() => {
        this.resolving.delete(item)
        reject(new CancellationError())
      })
      try {
        let resolved = await Promise.resolve(this.provider.resolveCompletionItem(item, token))
        disposable.dispose()
        if (!token.isCancellationRequested) {
          if (!resolved) {
            invalid = true
            this.resolving.delete(item)
          } else {
            if (resolved.textEdit) {
              let character = characterIndex(opt.line, opt.col)
              resolved.textEdit = fixTextEdit(character, resolved.textEdit)
            }
            // addDocumentation(item, completeItem, opt.filetype)
            Object.assign(item, resolved)
          }
        }
        resolve()
      } catch (e) {
        invalid = true
        this.resolving.delete(item)
        reject(e)
      }
    })
    if (!invalid) {
      this.resolving.set(item, promise)
    }
    return promise
  }

  public async onCompleteDone(item: CompletionItem, opt: CompleteDoneOption): Promise<void> {
    let doc = workspace.getDocument(opt.bufnr)
    await doc.patchChange(true)
    let additionalEdits = !isFalsyOrEmpty(item.additionalTextEdits)
    if (additionalEdits) {
      let shouldCancel = await snippetManager.editsInsideSnippet(item.additionalTextEdits)
      if (shouldCancel) snippetManager.cancel()
    }
    let version = doc.version
    let isSnippet = await this.applyTextEdit(doc, additionalEdits, item, opt)
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

  private async applyTextEdit(doc: Document, additionalEdits: boolean, item: CompletionItem, option: CompleteDoneOption): Promise<boolean> {
    let { linenr, col } = option
    let { character, line } = this.triggerContext
    let pos = await getLineAndPosition(workspace.nvim)
    if (pos.line != linenr - 1) return
    let { textEdit, insertText, label } = item
    let range = getReplaceRange(item, this.itemDefaults, undefined, option.insertMode)
    if (!range) {
      // create default replace range
      let end = character + (option.insertMode == InsertMode.Insert ? 0 : option.followWord.length)
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
    if (option.snippetsSupport !== false && isSnippetItem(item, this.itemDefaults)) {
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

export function fixIndent(line: string, currline: string, range: Range): number {
  let oldIndent = line.match(/^\s*/)[0]
  let newIndent = currline.match(/^\s*/)[0]
  if (oldIndent === newIndent) return 0
  let d = newIndent.length - oldIndent.length
  range.start.character += d
  range.end.character += d
  return d
}

export function fixTextEdit(character: number, edit: TextEdit | InsertReplaceEdit): TextEdit | InsertReplaceEdit {
  if (TextEdit.is(edit)) {
    if (character < edit.range.start.character) {
      edit.range.start.character = character
    }
  }
  if (InsertReplaceEdit.is(edit)) {
    if (character < edit.insert.start.character) {
      edit.insert.start.character = character
    }
    if (character < edit.replace.start.character) {
      edit.replace.start.character = character
    }
  }
  return edit
}
