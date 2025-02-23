'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Range } from 'vscode-languageserver-types'
import Document from '../model/document'
import { IConfigurationChangeEvent } from '../types'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import commands from '../commands'
import CursorSession, { CursorsConfig } from './session'
import { getVisualRanges, splitRange } from './util'

export type CursorPosition = [number, number, number, number]

export default class Cursors {
  private sessionsMap: Map<number, CursorSession> = new Map()
  private disposables: Disposable[] = []
  private config: CursorsConfig
  constructor(private nvim: Neovim) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    workspace.onDidCloseTextDocument(e => {
      let session = this.getSession(e.bufnr)
      if (!session) return
      this.sessionsMap.delete(e.bufnr)
      session.dispose()
    }, null, this.disposables)
    this.disposables.push(commands.registerCommand('editor.action.addRanges', async (ranges: Range[]) => {
      await this.addRanges(ranges)
    }, null, true))
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('cursors')) {
      let config = workspace.initialConfiguration
      this.config = config.get<CursorsConfig>('cursors')
    }
  }

  public cancel(uri: number | string): void {
    let doc = workspace.getDocument(uri)
    if (!doc) return
    let session = this.getSession(doc.bufnr)
    if (session) session.cancel()
  }

  public getSession(bufnr: number): CursorSession | undefined {
    return this.sessionsMap.get(bufnr)
  }

  public async isActivated(): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    return this.sessionsMap.get(bufnr) != null
  }

  public async select(bufnr: number, kind: string, mode: string): Promise<void> {
    let doc = workspace.getAttachedDocument(bufnr)
    let { nvim } = this
    let session = this.createSession(doc)
    let range: Range
    if (kind == 'operator') {
      let res = await nvim.eval(`[getpos("'["),getpos("']")]`) as [CursorPosition, CursorPosition]
      if (mode == 'char') {
        let start = doc.getPosition(res[0][1], res[0][2])
        let end = doc.getPosition(res[1][1], res[1][2] + 1)
        let ranges = splitRange(doc, Range.create(start, end))
        session.addRanges(ranges)
      } else {
        let ranges: Range[] = []
        for (let i = res[0][1] - 1; i <= res[1][1] - 1; i++) {
          let line = doc.getline(i)
          ranges.push(Range.create(i, 0, i, line.length))
        }
        session.addRanges(ranges)
      }
    } else if (kind == 'word') {
      let pos = await window.getCursorPosition()
      range = doc.getWordRangeAtPosition(pos)
      if (!range) {
        let line = doc.getline(pos.line)
        if (pos.character == line.length) {
          range = Range.create(pos.line, Math.max(0, line.length - 1), pos.line, line.length)
        } else {
          range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
        }
      }
      session.addRange(range)
      await nvim.command(`silent! call repeat#set("\\<Plug>(coc-cursors-${kind})", -1)`)
    } else if (kind == 'position') {
      let pos = await window.getCursorPosition()
      // make sure range contains character for highlight
      let line = doc.getline(pos.line)
      if (pos.character >= line.length) {
        range = Range.create(pos.line, line.length - 1, pos.line, line.length)
      } else {
        range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
      }
      session.addRange(range)
      await nvim.command(`silent! call repeat#set("\\<Plug>(coc-cursors-${kind})", -1)`)
    } else if (kind == 'range') {
      await nvim.call('eval', 'feedkeys("\\<esc>", "in")')
      let range = await window.getSelectedRange(mode)
      if (!range) return
      let ranges = mode == '\x16' ? getVisualRanges(doc, range) : splitRange(doc, range)
      for (let r of ranges) {
        session.addRange(r)
      }
    } else {
      throw new Error(`select kind "${kind}" not supported`)
    }
  }

  public createSession(doc: Document): CursorSession {
    let { bufnr } = doc
    let session = this.getSession(bufnr)
    if (session) return session
    session = new CursorSession(this.nvim, doc, this.config)
    this.sessionsMap.set(bufnr, session)
    session.onDidCancel(() => {
      session.dispose()
      this.sessionsMap.delete(bufnr)
    })
    return session
  }

  // Add ranges to current document
  public async addRanges(ranges: Range[]): Promise<boolean> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let doc = workspace.getAttachedDocument(bufnr)
    let session = this.createSession(doc)
    return session.addRanges(ranges)
  }

  public reset(): void {
    for (let session of this.sessionsMap.values()) {
      session.cancel()
    }
    this.sessionsMap.clear()
  }
}
