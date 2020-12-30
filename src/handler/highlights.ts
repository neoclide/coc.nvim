import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, DocumentHighlight, DocumentHighlightKind, Position, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import window from '../window'
import workspace from '../workspace'
const logger = require('../util/logger')('documentHighlight')

/**
 * Highlights of symbol under cursor.
 */
export default class Highlights {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  private highlights: Map<number, DocumentHighlight[]> = new Map()
  constructor(private nvim: Neovim) {
    events.on(['TextChanged', 'TextChangedI', 'CursorMoved', 'CursorMovedI'], () => {
      this.cancel()
      this.clearHighlights()
    }, null, this.disposables)
  }

  public clearHighlights(): void {
    if (this.highlights.size == 0) return
    let { nvim } = workspace
    for (let winid of this.highlights.keys()) {
      let win = nvim.createWindow(winid)
      win.clearMatchGroup('^CocHighlight')
    }
    this.highlights.clear()
  }

  public async highlight(): Promise<void> {
    let { nvim } = this
    this.cancel()
    let [bufnr, winid, cursors] = await nvim.eval(`[bufnr('%'),win_getid(),get(b:,'coc_cursors_activated',0)]`) as [number, number, number]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached || !languages.hasProvider('documentHighlight', doc.textDocument)) return
    if (cursors) return
    let position = await window.getCursorPosition()
    let highlights = await this.getHighlights(doc, position)
    if (!highlights) return
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      if (!hl.range) continue
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    let win = nvim.createWindow(winid)
    nvim.pauseNotification()
    win.clearMatchGroup('^CocHighlight')
    for (let hlGroup of Object.keys(groups)) {
      win.highlightRanges(hlGroup, groups[hlGroup], -1, true)
    }
    if (workspace.isVim) nvim.command('redraw', true)
    let res = this.nvim.resumeNotification()
    if (Array.isArray(res) && res[1] != null) {
      logger.error(`Error on highlight`, res[1][2])
    } else {
      this.highlights.set(winid, highlights)
    }
  }

  public hasHighlights(winid: number): boolean {
    return this.highlights.get(winid) != null
  }

  public async getHighlights(doc: Document | null, position: Position): Promise<DocumentHighlight[]> {
    if (!doc || !doc.attached || doc.isCommandLine) return null
    let line = doc.getline(position.line)
    let ch = line[position.character]
    if (!ch || !doc.isWord(ch)) return null
    try {
      this.tokenSource = new CancellationTokenSource()
      doc.forceSync()
      let { token } = this.tokenSource
      let highlights = await languages.getDocumentHighLight(doc.textDocument, position, token)
      this.tokenSource = null
      if (token.isCancellationRequested) return null
      return highlights
    } catch (_e) {
      return null
    }
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.highlights.clear()
    this.cancel()
    disposeAll(this.disposables)
  }
}
