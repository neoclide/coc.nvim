import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import workspace from '../workspace'
import languages from '../languages'
import Colors from './colors'
import Document from '../model/document'
import { Range, Disposable, DocumentHighlight, DocumentHighlightKind, CancellationTokenSource, Position } from 'vscode-languageserver-protocol'
import { byteIndex, byteLength } from '../util/string'
import { disposeAll } from '../util'
const logger = require('../util/logger')('documentHighlight')

export default class DocumentHighlighter {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  constructor(private nvim: Neovim, private colors: Colors) {
    events.on('WinLeave', winid => {
      this.cancel()
      this.clearHighlight(winid)
    }, null, this.disposables)
    events.on('BufWinEnter', () => {
      this.cancel()
    }, null, this.disposables)
    events.on('CursorMoved', () => {
      this.cancel()
    }, null, this.disposables)
    events.on('InsertEnter', () => {
      this.clearHighlight()
    }, null, this.disposables)
  }

  public clearHighlight(winid?: number): void {
    let { nvim } = workspace
    nvim.call('coc#util#clear_highlights', winid ? [winid] : [], true)
    if (workspace.isVim) nvim.command('redraw', true)
  }

  public async highlight(bufnr: number, position: Position): Promise<void> {
    let { nvim } = this
    let doc = workspace.getDocument(bufnr)
    this.cancel()
    let highlights = await this.getHighlights(doc, position)
    if (!highlights || highlights.length == 0) {
      this.clearHighlight()
      return
    }
    if (workspace.bufnr != bufnr) return
    nvim.pauseNotification()
    this.clearHighlight()
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      if (!hl.range) continue
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    for (let hlGroup of Object.keys(groups)) {
      doc.matchAddRanges(groups[hlGroup], hlGroup, -1)
    }
    this.nvim.command('redraw', true)
    await this.nvim.resumeNotification(false, true)
  }

  public async getHighlights(document: Document | null, position: Position): Promise<DocumentHighlight[]> {
    if (!document) return null
    let ts = Date.now()
    let { bufnr } = document
    let line = document.getline(position.line)
    let ch = line[position.character]
    if (!ch || !document.isWord(ch) || this.colors.hasColorAtPostion(bufnr, position)) return null
    try {
      this.tokenSource = new CancellationTokenSource()
      let { token } = this.tokenSource
      let highlights = await languages.getDocumentHighLight(document.textDocument, position, token)
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
