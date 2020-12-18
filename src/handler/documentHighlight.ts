import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, DocumentHighlight, DocumentHighlightKind, Position, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import workspace from '../workspace'
import Colors from './colors'
const logger = require('../util/logger')('documentHighlight')

export default class DocumentHighlighter {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  constructor(private nvim: Neovim, private colors: Colors) {
    events.on('WinLeave', () => {
      this.cancel()
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
    nvim.call('coc#highlight#clear_match_group', [winid || 0, '^CocHighlight'], true)
    if (workspace.isVim) nvim.command('redraw', true)
  }

  public async highlight(doc: Document, winid: number, position: Position): Promise<void> {
    let { nvim } = this
    this.cancel()
    let highlights = await this.getHighlights(doc, position)
    let res = await nvim.eval(`[bufnr('%'),win_getid(),get(b:,'coc_cursors_activated',0)]`) as [number, number, number]
    if (res[1] != winid) return
    if (res[0] != doc.bufnr || res[2] || !highlights || highlights.length == 0) {
      this.clearHighlight(winid)
      return
    }
    let win = nvim.createWindow(winid)
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      if (!hl.range) continue
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    nvim.pauseNotification()
    win.clearMatchGroup('^CocHighlight')
    for (let hlGroup of Object.keys(groups)) {
      win.highlightRanges(hlGroup, groups[hlGroup], -1, true)
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.nvim.resumeNotification(false, true)
    if (workspace.isVim) nvim.command('redraw', true)
  }

  public async getHighlights(doc: Document | null, position: Position): Promise<DocumentHighlight[]> {
    if (!doc || !doc.attached || doc.isCommandLine) return null
    let { bufnr } = doc
    let line = doc.getline(position.line)
    let ch = line[position.character]
    if (!ch || !doc.isWord(ch) || this.colors.hasColorAtPostion(bufnr, position)) return null
    try {
      this.tokenSource = new CancellationTokenSource()
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
