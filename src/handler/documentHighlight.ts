import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import workspace from '../workspace'
import languages from '../languages'
import Colors from './colors'
import Document from '../model/document'
import * as array from '../util/array'
import { Range, Disposable, DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver-protocol'
import { byteIndex, byteLength } from '../util/string'
import { disposeAll } from '../util'
const logger = require('../util/logger')('documentHighlight')

const INITIAL_ID = 9999

export default class DocumentHighlighter {
  private colorId = INITIAL_ID
  private disposables: Disposable[] = []
  private matchIds: Set<number> = new Set()
  private cursorMoveTs: number
  constructor(private nvim: Neovim, private colors: Colors) {
    this.disposables.push(workspace.registerAutocmd({
      event: 'WinLeave',
      request: true,
      callback: () => {
        this.clearHighlight()
      }
    }))
    this.disposables.push(workspace.registerAutocmd({
      event: 'BufWinLeave',
      request: true,
      callback: () => {
        this.clearHighlight()
      }
    }))
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
    nvim.call('coc#util#clearmatches', [Array.from(matchIds)], true)
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
    nvim.pauseNotification()
    this.clearHighlight()
    this.colorId = INITIAL_ID
    let groups: { [index: string]: Range[] } = {}
    for (let hl of highlights) {
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
      groups[hlGroup] = groups[hlGroup] || []
      groups[hlGroup].push(hl.range)
    }
    for (let hlGroup of Object.keys(groups)) {
      this.highlightRanges(document, hlGroup, groups[hlGroup])
    }
    await this.nvim.resumeNotification(false, true)
  }

  private async getHighlights(document: Document | null): Promise<DocumentHighlight[]> {
    if (!document) return null
    let ts = Date.now()
    let { bufnr } = document
    let position = await workspace.getCursorPosition()
    let line = document.getline(position.line)
    let ch = line[position.character]
    if (!ch || !document.isWord(ch) || this.colors.hasColorAtPostion(bufnr, position)) {
      return null
    }
    let highlights: DocumentHighlight[] = await languages.getDocumentHighLight(document.textDocument, position)
    if (workspace.bufnr != document.bufnr || (this.cursorMoveTs && this.cursorMoveTs > ts)) {
      return null
    }
    return highlights
  }

  private highlightRanges(document: Document, hlGroup: string, ranges: Range[]): void {
    let { matchIds } = this
    let grouped = array.group<Range>(ranges, 8)
    for (let group of grouped) {
      let arr: number[][] = []
      for (let range of group) {
        let { start, end } = range
        let line = document.getline(start.line)
        if (end.line - start.line == 1 && end.character == 0) {
          arr.push([start.line + 1])
        } else {
          arr.push([start.line + 1, byteIndex(line, start.character) + 1, byteLength(line.slice(start.character, end.character))])
        }
      }
      let id = this.colorId
      this.colorId = id + 1
      let method = workspace.isVim ? 'callTimer' : 'call'
      this.nvim[method]('matchaddpos', [hlGroup, arr, 9, id], true)
      matchIds.add(id)
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
