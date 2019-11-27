import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import workspace from '../workspace'
import languages from '../languages'
import Colors from './colors'
import Document from '../model/document'
import { Range, Disposable, DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver-protocol'
import { byteIndex, byteLength } from '../util/string'
import { disposeAll } from '../util'
const logger = require('../util/logger')('documentHighlight')

export default class DocumentHighlighter {
  private disposables: Disposable[] = []
  private matchIds: Set<number> = new Set()
  private cursorMoveTs: number
  constructor(private nvim: Neovim, private colors: Colors) {
    events.on('BufWinEnter', () => {
      this.clearHighlight()
    }, null, this.disposables)
    events.on(['CursorMoved', 'CursorMovedI'], () => {
      this.cursorMoveTs = Date.now()
    }, null, this.disposables)
    events.on('InsertEnter', () => {
      this.clearHighlight()
    }, null, this.disposables)
  }

  // clear matchIds of current window
  public clearHighlight(): void {
    let { matchIds } = this
    let { nvim } = workspace
    if (matchIds.size == 0) return
    nvim.pauseNotification()
    nvim.call('coc#util#clearmatches', [Array.from(matchIds)], true)
    nvim.command('redraw', true)
    nvim.resumeNotification(false, true).catch(_e => {
      // noop
    })
    this.matchIds.clear()
  }

  public async highlight(bufnr: number): Promise<void> {
    let { nvim } = this
    let document = workspace.getDocument(bufnr)
    let highlights = await this.getHighlights(document)
    if (!highlights || highlights.length == 0) {
      this.clearHighlight()
      return
    }
    if (workspace.bufnr != bufnr) return
    nvim.pauseNotification()
    this.clearHighlight()
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    for (let hlGroup of Object.keys(groups)) {
      let ids = document.matchAddRanges(groups[hlGroup], hlGroup, -1)
      for (let id of ids) {
        this.matchIds.add(id)
      }
    }
    this.nvim.command('redraw', true)
    await this.nvim.resumeNotification(false, true)
  }

  public async getHighlights(document: Document | null): Promise<DocumentHighlight[]> {
    if (!document) return null
    let ts = Date.now()
    let { bufnr } = document
    let position = await workspace.getCursorPosition()
    let line = document.getline(position.line)
    let ch = line[position.character]
    if (!ch || !document.isWord(ch) || this.colors.hasColorAtPostion(bufnr, position)) return null
    try {
      let highlights = await languages.getDocumentHighLight(document.textDocument, position)
      if (workspace.bufnr != document.bufnr || (this.cursorMoveTs && this.cursorMoveTs > ts)) {
        return null
      }
      return highlights
    } catch (_e) {
      return null
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
