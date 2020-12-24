import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, DocumentHighlight, DocumentHighlightKind, Position, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import workspace from '../workspace'
import window from '../window'
const logger = require('../util/logger')('documentHighlight')

const namespaceKey = 'coc-highlight'

/**
 * Highlights of symbol under cursor.
 */
export default class Highlights {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  private highlights: Map<number, DocumentHighlight[]> = new Map()
  constructor(private nvim: Neovim) {
    events.on(['WinLeave', 'TextChanged', 'CursorMoved', 'InsertEnter'], () => {
      this.cancel()
    }, null, this.disposables)
    events.on('BufUnload', bufnr => {
      this.highlights.delete(bufnr)
    }, null, this.disposables)
  }

  public clearHighlight(bufnr: number): void {
    let { nvim } = workspace
    let buf = nvim.createBuffer(bufnr)
    buf.clearNamespace(namespaceKey)
    if (workspace.isVim) nvim.command('redraw', true)
    this.highlights.delete(bufnr)
  }

  public async highlight(): Promise<void> {
    let { nvim } = this
    this.cancel()
    let [bufnr, cursors] = await nvim.eval(`[bufnr('%'),get(b:,'coc_cursors_activated',0)]`) as [number, number]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached || !languages.hasProvider('documentHighlight', doc.textDocument)) return
    if (cursors) {
      this.clearHighlight(bufnr)
      return
    }
    let position = await window.getCursorPosition()
    let highlights = await this.getHighlights(doc, position)
    if (!highlights) {
      this.clearHighlight(bufnr)
      return
    }
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      if (!hl.range) continue
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    let buffer = nvim.createBuffer(bufnr)
    nvim.pauseNotification()
    buffer.clearNamespace(namespaceKey)
    for (let hlGroup of Object.keys(groups)) {
      buffer.highlightRanges(namespaceKey, hlGroup, groups[hlGroup])
    }
    if (workspace.isVim) nvim.command('redraw', true)
    let res = this.nvim.resumeNotification()
    if (Array.isArray(res) && res[1] != null) {
      logger.error(`Error on highlight`, res[1][2])
    } else {
      this.highlights.set(bufnr, highlights)
    }
  }

  public hasHighlights(bufnr: number): boolean {
    return this.highlights.get(bufnr) != null
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
    if (this.tokenSource) this.tokenSource.dispose()
    disposeAll(this.disposables)
  }
}
