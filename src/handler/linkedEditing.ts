'use strict'
import { Neovim, Window } from '@chemzqm/neovim'
import { Position, TextEdit } from 'vscode-languageserver-types'
import TextRange from '../cursors/textRange'
import { getBeforeCount, getChange, getDelta } from '../cursors/util'
import events from '../events'
import languages, { ProviderName } from '../languages'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { getConditionValue } from '../util'
import { debounce } from '../util/node'
import { emptyRange, positionInRange, rangeAdjacent, rangeInRange, rangeIntersect } from '../util/position'
import { CancellationTokenSource } from '../util/protocol'
import { characterIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'

const debounceTime = getConditionValue(200, 10)

export default class LinkedEditingHandler {
  private changing = false
  private window: Window | undefined
  private bufnr: number | undefined
  private ranges: TextRange[] | undefined
  private wordPattern: string | undefined
  private tokenSource: CancellationTokenSource | undefined
  public checkPosition: ((bufnr: number, cursor: [number, number]) => void) & { clear(): void }
  constructor(private nvim: Neovim, handler: HandlerDelegate) {
    this.checkPosition = debounce(this._checkPosition, debounceTime)
    handler.addDisposable(events.on('CursorMoved', (bufnr, cursor) => {
      this.cancel()
      this.checkPosition(bufnr, [cursor[0], cursor[1]])
    }))
    handler.addDisposable(events.on('CursorMovedI', (bufnr, cursor) => {
      this.cancel()
      this.checkPosition(bufnr, [cursor[0], cursor[1]])
    }))
    handler.addDisposable(window.onDidChangeActiveTextEditor(() => {
      this.cancel()
      this.cancelEdit()
    }))
    handler.addDisposable(events.on('InsertCharPre', (character, bufnr) => {
      if (bufnr !== this.bufnr) return
      let doc = workspace.getDocument(bufnr)
      if (!this.wordPattern) {
        if (!doc.isWord(character) && character !== '-') this.cancelEdit()
      } else {
        let r = new RegExp(this.wordPattern)
        if (!r.test(character)) this.cancelEdit()
      }
    }))
    handler.addDisposable(workspace.onDidChangeTextDocument(async e => {
      await this.onChange(e)
    }))
  }

  private cancelEdit(): void {
    this.window?.clearMatchGroup('^CocLinkedEditing')
    this.ranges = undefined
    this.window = undefined
    this.bufnr = undefined
  }

  public async onChange(e: DidChangeTextDocumentParams): Promise<void> {
    if (e.bufnr !== this.bufnr || this.changing || !this.ranges) return
    if (e.contentChanges.length === 0) {
      this.doHighlights()
      return
    }
    let change = e.contentChanges[0]
    let { text, range } = change
    let affected = this.ranges.filter(r => {
      if (!rangeIntersect(range, r.range)) return false
      if (rangeAdjacent(range, r.range)) {
        if (text.includes('\n') || !emptyRange(range)) return false
      }
      return true
    })
    if (affected.length == 1 && rangeInRange(range, affected[0].range)) {
      if (text.includes('\n')) {
        this.cancelEdit()
        return
      }
      // change textRange
      await this.applySingleEdit(affected[0], { range, newText: text })
    } else {
      this.cancelEdit()
    }
  }

  private async applySingleEdit(textRange: TextRange, edit: TextEdit): Promise<void> {
    // single range change, calculate & apply changes for all ranges
    let { bufnr, ranges } = this
    let doc = workspace.getDocument(bufnr)
    let after = ranges.filter(r => r !== textRange && r.position.line == textRange.position.line)
    after.forEach(r => r.adjustFromEdit(edit))
    let change = getChange(textRange, edit.range, edit.newText)
    let delta = getDelta(change)
    ranges.forEach(r => r.applyChange(change))
    let edits = ranges.filter(r => r !== textRange).map(o => o.textEdit)
    // logger.debug('edits:', JSON.stringify(edits, null, 2))
    this.changing = true
    await doc.applyEdits(edits, true, true)
    this.changing = false
    if (delta != 0) {
      for (let r of ranges) {
        let n = getBeforeCount(r, this.ranges, textRange)
        r.move(n * delta)
      }
    }
    this.doHighlights()
  }

  private doHighlights(): void {
    let { window, ranges, nvim } = this
    if (window && ranges) {
      nvim.pauseNotification()
      window.clearMatchGroup('^CocLinkedEditing')
      window.highlightRanges('CocLinkedEditing', ranges.map(o => o.range), 99, true)
      nvim.resumeNotification(true, true)
    }
  }

  private _checkPosition(bufnr: number, cursor: [number, number]): void {
    if (events.pumvisible || !workspace.isAttached(bufnr)) return
    let doc = workspace.getDocument(bufnr)
    let config = workspace.getConfiguration('coc.preferences', doc)
    let enabled = config.get<boolean>('enableLinkedEditing', false)
    if (!enabled || !languages.hasProvider(ProviderName.LinkedEditing, doc.textDocument)) return
    let character = characterIndex(doc.getline(cursor[0] - 1), cursor[1] - 1)
    let position = Position.create(cursor[0] - 1, character)
    if (this.ranges) {
      if (this.ranges.some(r => positionInRange(position, r.range) == 0)) {
        return
      }
      this.cancelEdit()
    }
    void this.enable(doc, position)
  }

  public async enable(doc: Document, position: Position): Promise<void> {
    let textDocument = doc.textDocument
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let win = await this.nvim.window
    let linkedRanges = await languages.provideLinkedEdits(textDocument, position, token)
    if (token.isCancellationRequested || !linkedRanges || linkedRanges.ranges.length == 0) return
    let ranges = linkedRanges.ranges.map(o => new TextRange(o.start.line, o.start.character, textDocument.getText(o)))
    this.wordPattern = linkedRanges.wordPattern
    this.bufnr = doc.bufnr
    this.window = win
    this.ranges = ranges
    this.doHighlights()
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }
}
