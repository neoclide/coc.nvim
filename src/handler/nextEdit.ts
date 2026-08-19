'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InlineCompletionTriggerKind, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import { CancellationTokenSource, Disposable } from '../util/protocol'
import { wait, waitWithToken } from '../util'
import { byteIndex } from '../util/string'
import { comparePosition, getEnd, positionInRange } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import { NextEditContext, NextEditItem } from '../provider'
import Document from '../model/document'
import { HandlerDelegate } from './types'

const logger = createLogger('handler-next-edit')
const NAMESPACE = 'nextEdit'

export type NextEditState = 'idle' | 'waiting' | 'requesting' | 'ready' | 'preview' | 'applying'
interface SourceSnapshot { uri: string; version: number; position: Position; bufnr: number }
interface PreviewSnapshot { uri: string; version: number; range: Range; originalText: string }
interface Session { source: SourceSnapshot; items: NextEditItem[]; index: number; shownIndexes: Set<number> }

function validPosition(doc: Document, pos: Position): boolean {
  return Number.isInteger(pos.line) && Number.isInteger(pos.character) && pos.line >= 0 && pos.line < doc.textDocument.lineCount
    && pos.character >= 0 && pos.character <= doc.textDocument.lineAt(pos.line).text.length
}

function validRange(doc: Document, range: Range): boolean {
  return !!range && validPosition(doc, range.start) && validPosition(doc, range.end)
    && (range.start.line < range.end.line || (range.start.line === range.end.line && range.start.character <= range.end.character))
}

function validRangeShape(range: Range): boolean {
  return !!range && Number.isInteger(range.start?.line) && Number.isInteger(range.start?.character)
    && Number.isInteger(range.end?.line) && Number.isInteger(range.end?.character)
    && range.start.line >= 0 && range.start.character >= 0 && range.end.line >= 0 && range.end.character >= 0
    && (range.start.line < range.end.line || (range.start.line === range.end.line && range.start.character <= range.end.character))
}

export default class NextEdit {
  private state: NextEditState = 'idle'
  private session: Session | undefined
  private preview: PreviewSnapshot | undefined
  private source: CancellationTokenSource | undefined
  private namespace: number | undefined
  private renderedBufnrs = new Set<number>()
  private applying = false
  private disposables: Disposable[] = []
  private config = { autoTrigger: true, triggerWait: 150 }

  constructor(private nvim: Neovim, private handler: HandlerDelegate, private inline: { session: unknown; onDidChangeVisibility: (cb: (visible: boolean) => void) => Disposable }) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    workspace.onDidChangeTextDocument(e => {
      // Invalidate the current session on document changes even when auto
      // triggering is disabled, so stale previews are not kept around.
      if (!this.applying && this.session && e.bufnr === this.session.source.bufnr) this.cancel()
      if (this.applying || !this.config.autoTrigger || e.bufnr !== window.activeTextEditor?.bufnr) return
      let doc = workspace.getDocument(e.bufnr)
      if (doc?.attached && languages.hasProvider(ProviderName.NextEdit, doc.textDocument)) this.trigger(e.bufnr, { autoTrigger: true }, this.config.triggerWait).catch(logger.error)
    }, null, this.disposables)
    workspace.onDidCloseTextDocument(e => {
      if (e.bufnr === this.session?.source.bufnr) this.cancel()
    }, null, this.disposables)
    this.disposables.push(this.inline.onDidChangeVisibility(() => { this.render().catch(logger.error) }))
  }

  private loadConfiguration(): void {
    let config = workspace.getConfiguration('nextEdit', window.activeTextEditor?.document)
    this.config.autoTrigger = config.get('autoTrigger', true)
    this.config.triggerWait = config.get('triggerWait', 150)
  }

  private async clearRender(): Promise<void> {
    if (this.namespace != null) {
      for (let bufnr of this.renderedBufnrs) {
        workspace.nvim.createBuffer(bufnr).clearNamespace(this.namespace)
        workspace.nvim.createBuffer(bufnr).setVar('coc_next_edit_state', 0, true)
      }
    }
    this.renderedBufnrs.clear()
    if (this.session) workspace.nvim.createBuffer(this.session.source.bufnr).setVar('coc_next_edit_state', 0, true)
  }

  private async render(): Promise<void> {
    await this.clearRender()
    let session = this.session
    if (!session || this.inline.session) return
    let item = session.items[session.index]
    let target = workspace.getDocument(item.textDocument.uri)
    if (!target || target.bufnr !== window.activeTextEditor?.bufnr || !this.preview) {
      this.state = 'ready'
      this.renderedBufnrs.add(session.source.bufnr)
      workspace.nvim.createBuffer(session.source.bufnr).setVar('coc_next_edit_state', 1, true)
      return
    }
    if (this.namespace == null) {
      this.namespace = await this.nvim.createNamespace(NAMESPACE) as number
      if (this.session !== session) return
    }
    let text = item.newText.length ? `Next edit: ${item.newText.replace(/\n/g, ' ↵ ')}` : 'Next edit: delete'
    let line = item.range.start.line
    // coc#vtext#add expects a 1 based byte column, same as inline completion.
    let col = byteIndex(target.getline(line), item.range.start.character) + 1
    // Track the buffer before the RPC round trip so a cancel that happens
    // while the request is in flight still clears this virtual text.
    this.renderedBufnrs.add(target.bufnr)
    await this.nvim.call('coc#vtext#add', [target.bufnr, this.namespace, line, [[text, item.newText ? 'CocNextEditInsert' : 'CocNextEditDelete']], { col }])
    if (this.session !== session) return
    workspace.nvim.createBuffer(target.bufnr).setVar('coc_next_edit_state', 2, true)
    this.state = 'preview'
    if (!session.shownIndexes.has(session.index)) {
      session.shownIndexes.add(session.index)
      languages.nextEditManager.handleDidShow(item)
    }
  }

  private validate(item: NextEditItem): { doc: Document; originalText: string } | undefined {
    if (!item?.textDocument || !Number.isInteger(item.textDocument.version) || typeof item.newText !== 'string') return
    let doc = workspace.getDocument(item.textDocument.uri)
    if (!doc?.attached || doc.version !== item.textDocument.version || !validRange(doc, item.range)) return
    let originalText = doc.textDocument.getText(item.range)
    let newText = item.newText.replace(/\r\n?/g, '\n')
    if (originalText === newText) return
    item.newText = newText
    return { doc, originalText }
  }

  private validCandidate(item: NextEditItem): boolean {
    if (!item?.textDocument || !Number.isInteger(item.textDocument.version) || typeof item.newText !== 'string' || !validRangeShape(item.range)) return false
    let doc = workspace.getDocument(item.textDocument.uri)
    if (!doc || !doc.attached) {
      item.newText = item.newText.replace(/\r\n?/g, '\n')
      return true
    }
    return !!this.validate(item)
  }

  public async trigger(bufnr: number, option: { provider?: string; autoTrigger?: boolean } = {}, delay = 0): Promise<boolean> {
    this.cancel()
    let doc = workspace.getDocument(bufnr)
    if (!doc?.attached || !languages.hasProvider(ProviderName.NextEdit, doc.textDocument)) return false
    this.state = delay ? 'waiting' : 'requesting'
    let source = this.source = new CancellationTokenSource()
    let requestId = source
    let disable = await this.nvim.createBuffer(bufnr).getVar('coc_next_edit_disable') as number
    if (disable === 1) {
      this.cancel()
      return false
    }
    if (delay) await waitWithToken(delay, source.token)
    if (source.token.isCancellationRequested || this.source !== requestId) return false
    await doc.synchronize()
    let [nr, pos] = await this.nvim.eval('[bufnr("%"),coc#cursor#position()]') as [number, [number, number]]
    if (nr !== bufnr) {
      this.cancel()
      return false
    }
    let position = Position.create(pos[0], pos[1])
    let items = await languages.provideNextEdits(doc.textDocument, position, { provider: option.provider, triggerKind: option.autoTrigger ? InlineCompletionTriggerKind.Automatic : InlineCompletionTriggerKind.Invoked }, source.token)
    if (source.token.isCancellationRequested || this.source !== requestId) return false
    this.source = undefined
    let valid = items.filter(item => this.validCandidate(item))
    if (!valid.length) { this.cancel(); return false }
    this.session = { source: { uri: doc.uri, version: doc.version, position, bufnr }, items: valid, index: 0, shownIndexes: new Set() }
    this.state = 'ready'
    let selected = valid[0]
    let target = workspace.getDocument(selected.textDocument.uri)
    if (target?.bufnr === bufnr && validPosition(target, selected.range.start) && (positionInRange(position, selected.range) === 0 || comparePosition(position, selected.range.start) === 0)) {
      let checked = this.validate(selected)
      if (checked) this.preview = { uri: target.uri, version: target.version, range: selected.range, originalText: checked.originalText }
    }
    await this.render()
    return true
  }

  public async accept(): Promise<boolean> {
    if (this.inline.session || !this.session || (this.state !== 'ready' && this.state !== 'preview')) return false
    let session = this.session
    let item = session.items[session.index]
    if (this.state === 'ready') {
      await workspace.jumpTo(item.textDocument.uri, item.range.start)
      if (this.session !== session) { this.cancel(); return false }
      let checked = await this.waitForValidate(item)
      if (!checked || this.session !== session) { this.cancel(); return false }
      this.preview = { uri: checked.doc.uri, version: checked.doc.version, range: item.range, originalText: checked.originalText }
      await this.render()
      return true
    }
    this.state = 'applying'
    let checked = this.validate(item)
    if (!checked || !this.preview || this.preview.uri !== checked.doc.uri || this.preview.version !== checked.doc.version || this.preview.originalText !== checked.originalText) { this.cancel(); return false }
    this.applying = true
    try {
      await checked.doc.applyEdits([TextEdit.replace(item.range, item.newText)], false, false)
      await window.moveTo(getEnd(item.range.start, item.newText))
    } finally {
      this.applying = false
    }
    if (item.command) {
      try { await commands.execute(item.command) } catch (err) { logger.error(`Error on execute command "${item.command.command}"`, err) }
    }
    this.cancel()
    return true
  }

  /**
   * Validate a candidate, waiting briefly for the target document to attach
   * after it was opened by workspace.jumpTo.
   */
  private async waitForValidate(item: NextEditItem): Promise<{ doc: Document; originalText: string } | undefined> {
    let deadline = Date.now() + 300
    let checked = this.validate(item)
    while (!checked && Date.now() < deadline) {
      await wait(20)
      checked = this.validate(item)
    }
    return checked
  }

  public cancel(): void {
    if (this.source) { this.source.cancel(); this.source.dispose(); this.source = undefined }
    void this.clearRender()
    this.session = undefined
    this.preview = undefined
    this.state = 'idle'
  }
  public async next(): Promise<void> { await this.switchCandidate(1) }
  public async prev(): Promise<void> { await this.switchCandidate(-1) }
  private async switchCandidate(delta: number): Promise<void> {
    if (!this.session || this.session.items.length < 2) return
    this.session.index = (this.session.index + delta + this.session.items.length) % this.session.items.length
    this.preview = undefined
    let item = this.session.items[this.session.index]
    let target = workspace.getDocument(item.textDocument.uri)
    if (target?.bufnr === this.session.source.bufnr && (positionInRange(this.session.source.position, item.range) === 0 || comparePosition(this.session.source.position, item.range.start) === 0)) {
      let checked = this.validate(item)
      if (checked) this.preview = { uri: checked.doc.uri, version: checked.doc.version, range: item.range, originalText: checked.originalText }
    }
    await this.render()
  }
  public available(): boolean { return this.state === 'ready' || this.state === 'preview' }
  public visible(): boolean { return this.state === 'preview' }
  public dispose(): void { this.cancel(); for (let d of this.disposables) d.dispose() }
}
