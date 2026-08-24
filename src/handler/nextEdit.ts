'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InlineCompletionTriggerKind, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import { CancellationTokenSource, Disposable } from '../util/protocol'
import { wait, waitWithToken } from '../util'
import { fastDiff } from '../util/node'
import { byteIndex } from '../util/string'
import { comparePosition, getEnd, positionInRange } from '../util/position'
import { getPosition } from '../util/textedit'
import window from '../window'
import workspace from '../workspace'
import { NextEditContext, NextEditItem } from '../provider'
import Document from '../model/document'
import { FloatFactory, HighlightItem } from '../types'
import { HandlerDelegate } from './types'

const logger = createLogger('handler-next-edit')
const NAMESPACE = 'coc-nextEdit'

export type NextEditState = 'idle' | 'waiting' | 'requesting' | 'ready' | 'preview' | 'applying'
interface SourceSnapshot { uri: string; version: number; position: Position; bufnr: number }
interface PreviewSnapshot { uri: string; version: number; range: Range; originalText: string }
interface Session { source: SourceSnapshot; items: NextEditItem[]; index: number; shownIndexes: Set<number> }
interface TextInsertion { position: Position; text: string }
interface PreviewChanges { deletions: Range[]; deletedNewlines: Position[]; insertions: TextInsertion[] }
interface NextEditVirtualTextOptions {
  col: number
  hl_mode: 'replace'
  virt_lines?: [string, string][][]
}

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

function sameTextPosition(one: string, two: string): boolean {
  let oneEnd = getEnd(Position.create(0, 0), one)
  let twoEnd = getEnd(Position.create(0, 0), two)
  return oneEnd.line === twoEnd.line && oneEnd.character === twoEnd.character
}

/**
 * Compare the part of a replacement corresponding to the original text before
 * the cursor. A deletion crossing the cursor has no unambiguous corresponding
 * position in the replacement, so it is rejected.
 */
function keepsCursorPrefix(originalText: string, newText: string, cursorOffset: number): boolean {
  let originalPrefix = ''
  let newPrefix = ''
  let used = 0
  let replacementAtCursor = false
  for (let [kind, text] of fastDiff(originalText, newText)) {
    if (kind === fastDiff.EQUAL) {
      let remaining = cursorOffset - used
      if (remaining <= 0) break
      let part = text.slice(0, remaining)
      originalPrefix += part
      newPrefix += part
      used += part.length
      replacementAtCursor = false
      if (part.length < text.length || used === cursorOffset) break
    } else if (kind === fastDiff.DELETE) {
      let remaining = cursorOffset - used
      if (remaining <= 0) break
      if (text.length > remaining) return false
      originalPrefix += text
      used += text.length
      replacementAtCursor = used === cursorOffset
    } else if (used < cursorOffset || replacementAtCursor) {
      newPrefix += text
    } else {
      break
    }
  }
  return sameTextPosition(originalPrefix, newPrefix)
}

function getPreviewChanges(range: Range, originalText: string, newText: string): PreviewChanges {
  let deletions: Range[] = []
  let deletedNewlines: Position[] = []
  let insertions: TextInsertion[] = []
  let position = range.start
  let diffs = fastDiff(originalText, newText)
  for (let i = 0; i < diffs.length; i++) {
    let [kind, text] = diffs[i]
    if (kind === fastDiff.INSERT) {
      insertions.push({ position: Position.create(position.line, position.character), text })
    } else {
      let start = position
      let end = getEnd(position, text)
      if (kind === fastDiff.DELETE) {
        deletions.push(Range.create(position, end))
        let newlinePosition = position
        let parts = text.split('\n')
        for (let part of parts.slice(0, -1)) {
          newlinePosition = getEnd(newlinePosition, part)
          deletedNewlines.push(newlinePosition)
          newlinePosition = Position.create(newlinePosition.line + 1, 0)
        }
        let next = diffs[i + 1]
        if (next?.[0] === fastDiff.INSERT) {
          insertions.push({ position: Position.create(start.line, start.character), text: next[1] })
          i++
        }
      }
      position = end
    }
  }
  return { deletions, deletedNewlines, insertions }
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
  private floatFactory: FloatFactory
  private config = { autoTrigger: true, triggerWait: 150 }

  constructor(private nvim: Neovim, private handler: HandlerDelegate, private inline: { session: unknown; onDidChangeVisibility: (cb: (visible: boolean) => void) => Disposable }) {
    this.loadConfiguration()
    this.floatFactory = window.createFloatFactory({ modes: ['n', 'i'], autoHide: false, breaks: false, maxWidth: 60 })
    this.disposables.push(this.floatFactory)
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(this.loadConfiguration, this, this.disposables)
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
    this.floatFactory.close()
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
    let index = session.index
    let item = session.items[index]
    let target = workspace.getDocument(item.textDocument.uri)
    if (!target || target.bufnr !== window.activeTextEditor?.bufnr || !this.preview) {
      this.state = 'ready'
      this.renderedBufnrs.add(session.source.bufnr)
      workspace.nvim.createBuffer(session.source.bufnr).setVar('coc_next_edit_state', 1, true)
      if (item.textDocument.uri !== session.source.uri) {
        let uri = URI.parse(item.textDocument.uri)
        let filepath = workspace.getRelativePath(uri) || uri.path || item.textDocument.uri
        await this.floatFactory.show([{ content: `Next edit in ${filepath}:${item.range.start.line + 1}`, filetype: 'txt' }])
      }
      return
    }
    if (this.namespace == null) {
      this.namespace = await this.nvim.createNamespace(NAMESPACE) as number
      if (this.session !== session || session.index !== index) return
    }
    let changes = getPreviewChanges(item.range, this.preview.originalText, item.newText)
    let highlights: HighlightItem[] = []
    for (let range of changes.deletions) {
      target.addHighlights(highlights, 'CocNextEditDelete', range, { combine: false })
    }
    // Track the buffer before the RPC round trip so a cancel that happens
    // while a request is in flight still clears all preview artifacts.
    this.renderedBufnrs.add(target.bufnr)
    let highlightDefs = highlights.map(item => [item.hlGroup, item.lnum, item.colStart, item.colEnd, item.combine === false ? 0 : 1, 0, 0])
    this.nvim.call('coc#highlight#buffer_update', [target.bufnr, this.namespace, highlightDefs, 4096, null], true)
    for (let position of changes.deletedNewlines) {
      let col = byteIndex(target.getline(position.line), position.character) + 1
      await this.nvim.call('coc#vtext#add', [target.bufnr, this.namespace, position.line, [['↵', 'CocNextEditDelete']], { col, hl_mode: 'replace' }])
      if (this.session !== session || session.index !== index) return
    }
    for (let insertion of changes.insertions) {
      let lines = insertion.text.split('\n')
      let col = byteIndex(target.getline(insertion.position.line), insertion.position.character) + 1
      let options: NextEditVirtualTextOptions = { col, hl_mode: 'replace' }
      if (lines.length > 1) options.virt_lines = lines.slice(1).map(line => [[line || ' ', 'CocNextEditInsert']])
      let blocks = lines[0] ? [[lines[0], 'CocNextEditInsert']] : []
      await this.nvim.call('coc#vtext#add', [target.bufnr, this.namespace, insertion.position.line, blocks, options])
      if (this.session !== session || session.index !== index) return
    }
    if (this.session !== session || session.index !== index) return
    workspace.nvim.createBuffer(target.bufnr).setVar('coc_next_edit_state', 2, true)
    this.state = 'preview'
    if (!session.shownIndexes.has(index)) {
      session.shownIndexes.add(index)
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

  private keepsCursorPosition(doc: Document, item: NextEditItem, position: Position, originalText: string): boolean {
    if (comparePosition(item.range.start, position) >= 0) return true
    if (comparePosition(item.range.end, position) <= 0) {
      let next = getPosition(position, TextEdit.replace(item.range, item.newText))
      return next.line === position.line && next.character === position.character
    }
    let cursorOffset = doc.textDocument.offsetAt(position) - doc.textDocument.offsetAt(item.range.start)
    return keepsCursorPrefix(originalText, item.newText, cursorOffset)
  }

  private validCandidate(item: NextEditItem, source?: { uri: string; position: Position }): boolean {
    if (!item?.textDocument || !Number.isInteger(item.textDocument.version) || typeof item.newText !== 'string' || !validRangeShape(item.range)) return false
    let doc = workspace.getDocument(item.textDocument.uri)
    if (!doc || !doc.attached) {
      item.newText = item.newText.replace(/\r\n?/g, '\n')
      return true
    }
    let checked = this.validate(item)
    if (!checked) return false
    return !source || item.textDocument.uri !== source.uri || this.keepsCursorPosition(doc, item, source.position, checked.originalText)
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
    let valid = items.filter(item => this.validCandidate(item, { uri: doc.uri, position }))
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
