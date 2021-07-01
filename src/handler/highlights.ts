import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, DocumentHighlight, DocumentHighlightKind, Position, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { HandlerDelegate } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('documentHighlight')

/**
 * Highlight same symbols.
 * Highlights are added to window by matchaddpos.
 */
export default class Highlights {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  private highlights: Map<number, DocumentHighlight[]> = new Map()
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    events.on(['CursorMoved', 'CursorMovedI'], () => {
      this.cancel()
      this.clearHighlights()
    }, null, this.disposables)
  }

  public clearHighlights(): void {
    if (this.highlights.size == 0) return
    for (let winid of this.highlights.keys()) {
      let win = this.nvim.createWindow(winid)
      win.clearMatchGroup('^CocHighlight')
    }
    this.highlights.clear()
  }

  public async highlight(): Promise<void> {
    let { nvim } = this
    this.cancel()
    let [bufnr, winid, pos, cursors] = await nvim.eval(`[bufnr("%"),win_getid(),coc#util#cursor(),get(b:,'coc_cursors_activated',0)]`) as [number, number, [number, number], number]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached || cursors) return
    if (!languages.hasProvider('documentHighlight', doc.textDocument)) return
    let highlights = await this.getHighlights(doc, Position.create(pos[0], pos[1]))
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
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    this.highlights.set(winid, highlights)
  }

  public async getSymbolsRanges(): Promise<Range[]> {
    let { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('documentHighlight', doc.textDocument)
    let highlights = await this.getHighlights(doc, position)
    if (!highlights) return null
    return highlights.map(o => o.range)
  }

  public hasHighlights(winid: number): boolean {
    return this.highlights.get(winid) != null
  }

  public async getHighlights(doc: Document, position: Position): Promise<DocumentHighlight[]> {
    let line = doc.getline(position.line)
    let ch = line[position.character]
    if (!ch || !doc.isWord(ch)) return null
    this.tokenSource = new CancellationTokenSource()
    doc.forceSync()
    let source = this.tokenSource
    let highlights = await languages.getDocumentHighLight(doc.textDocument, position, source.token)
    if (source == this.tokenSource) {
      source.dispose()
      this.tokenSource = null
    }
    if (source.token.isCancellationRequested) return null
    return highlights
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
