import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-jsonrpc'
import { Range } from 'vscode-languageserver-types'
import events from '../events'
import Document from '../model/document'
import { comparePosition } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import CursorSession from './session'
import { getVisualRanges, splitRange } from './util'
const logger = require('../util/logger')('cursors')

interface Config {
  cancelKey: string
  previousKey: string
  nextKey: string
}

export default class Cursors {
  private sessionsMap: Map<number, CursorSession> = new Map()
  private disposables: Disposable[] = []
  private config: Config
  constructor(private nvim: Neovim) {
    this.loadConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cursors')) {
        this.loadConfig()
      }
    }, null, this.disposables)
    events.on('BufUnload', bufnr => {
      let session = this.getSession(bufnr)
      if (!session) return
      session.dispose()
      this.sessionsMap.delete(bufnr)
    }, null, this.disposables)
  }

  private loadConfig(): void {
    let config = workspace.getConfiguration('cursors')
    this.config = {
      nextKey: config.get('nextKey', '<C-n>'),
      previousKey: config.get('previousKey', '<C-p>'),
      cancelKey: config.get('cancelKey', '<esc>')
    }
  }

  public getSession(bufnr: number): CursorSession | undefined {
    return this.sessionsMap.get(bufnr)
  }

  public async isActivated(): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    return this.sessionsMap.get(bufnr) != null
  }

  public async select(bufnr: number, kind: string, mode: string): Promise<void> {
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) {
      window.showMessage(`buffer ${bufnr} not attached.`)
      return
    }
    let { nvim } = this
    let session = this.createSession(doc)
    let pos = await window.getCursorPosition()
    let range: Range
    if (kind == 'operator') {
      await nvim.command(`normal! ${mode == 'line' ? `'[` : '`['}`)
      let start = await window.getCursorPosition()
      await nvim.command(`normal! ${mode == 'line' ? `']` : '`]'}`)
      let end = await window.getCursorPosition()
      await window.moveTo(pos)
      let relative = comparePosition(start, end)
      // do nothing for empty range
      if (relative == 0) return
      if (relative >= 0) [start, end] = [end, start]
      // include end character
      let line = doc.getline(end.line)
      if (end.character < line.length) {
        end.character = end.character + 1
      }
      let ranges = splitRange(doc, Range.create(start, end))
      for (let r of ranges) {
        let text = doc.textDocument.getText(r)
        session.addRange(r, text)
      }
    } else if (kind == 'word') {
      range = doc.getWordRangeAtPosition(pos)
      if (!range) {
        let line = doc.getline(pos.line)
        if (pos.character == line.length) {
          range = Range.create(pos.line, Math.max(0, line.length - 1), pos.line, line.length)
        } else {
          range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
        }
      }
      let line = doc.getline(pos.line)
      let text = line.slice(range.start.character, range.end.character)
      session.addRange(range, text)
    } else if (kind == 'position') {
      // make sure range contains character for highlight
      let line = doc.getline(pos.line)
      if (pos.character >= line.length) {
        range = Range.create(pos.line, line.length - 1, pos.line, line.length)
      } else {
        range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
      }
      session.addRange(range, line.slice(range.start.character, range.end.character))
    } else if (kind == 'range') {
      await nvim.call('eval', 'feedkeys("\\<esc>", "in")')
      let range = await workspace.getSelectedRange(mode, doc)
      if (!range || comparePosition(range.start, range.end) == 0) return
      let ranges = mode == '\x16' ? getVisualRanges(doc, range) : splitRange(doc, range)
      for (let r of ranges) {
        let text = doc.textDocument.getText(r)
        session.addRange(r, text)
      }
    } else {
      window.showMessage(`${kind} not supported`, 'error')
      return
    }
    if (kind == 'word' || kind == 'position') {
      await nvim.command(`silent! call repeat#set("\\<Plug>(coc-cursors-${kind})", -1)`)
    }
  }

  private createSession(doc: Document): CursorSession {
    let session = this.getSession(doc.bufnr)
    if (session) return session
    session = new CursorSession(this.nvim, doc, this.config)
    this.sessionsMap.set(doc.bufnr, session)
    session.onDidCancel(() => {
      session.dispose()
      this.sessionsMap.delete(doc.bufnr)
    })
    return session
  }

  // Add ranges to current document
  public async addRanges(ranges: Range[]): Promise<boolean> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) {
      window.showMessage('Document not attached', 'error')
      return false
    }
    let session = this.createSession(doc)
    return session.addRanges(ranges)
  }

  public reset(): void {
    for (let session of this.sessionsMap.values()) {
      session.cancel()
    }
    this.sessionsMap.clear()
  }

  public dispose(): void {
    for (let session of this.sessionsMap.values()) {
      session.dispose()
    }
    this.sessionsMap.clear()
    for (let disposable of this.disposables) {
      disposable.dispose()
    }
  }
}
