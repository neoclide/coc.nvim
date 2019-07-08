import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-jsonrpc'
import { Range, TextDocument, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import Document from '../model/document'
import { disposeAll } from '../util'
import { comparePosition, rangeIntersect, rangeInRange } from '../util/position'
import workspace from '../workspace'
import TextRange from './range'
const logger = require('../util/logger')('cursors')

interface Config {
  cancelKey: string
  previousKey: string
  nextKey: string
}

export default class Cursors {
  private _activated = false
  private _changed = false
  private ranges: TextRange[] = []
  private disposables: Disposable[] = []
  private bufnr: number
  private winid: number
  private matchIds: number[] = []
  private textDocument: TextDocument
  private version = -1
  private config: Config
  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('cursors')
    this.config = {
      nextKey: config.get('nextKey', '<C-n>'),
      previousKey: config.get('previousKey', '<C-p>'),
      cancelKey: config.get('cancelKey', '<esc>')
    }
  }

  public async select(bufnr: number, kind: string, mode: string): Promise<void> {
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let { nvim } = this
    if (this._changed || bufnr != this.bufnr) {
      this.cancel()
    }
    let pos = await workspace.getCursorPosition()
    let range: Range
    let text = ''
    if (mode == 'n') {
      if (kind == 'word') {
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
        text = line.slice(range.start.character, range.end.character)
      } else {
        // make sure range contains character for highlight
        let line = doc.getline(pos.line)
        if (pos.character >= line.length) {
          range = Range.create(pos.line, line.length - 1, pos.line, line.length)
        } else {
          range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
        }
      }
      this.addRange(range, text)
    } else {
      await nvim.call('eval', 'feedkeys("\\<esc>", "in")')
      let range = await workspace.getSelectedRange(mode, doc)
      if (!range || range.start.line != range.end.line) return
      text = doc.textDocument.getText(range)
      this.addRange(range, text)
    }
    if (workspace.bufnr != bufnr) return
    if (this._activated && !this.ranges.length) {
      this.cancel()
    } else if (this.ranges.length && !this._activated) {
      this.activate(doc)
    }
    if (this._activated) {
      nvim.pauseNotification()
      this.doHighlights()
      if (workspace.isVim) {
        nvim.command('redraw', true)
      }
      let [, err] = await nvim.resumeNotification()
      if (err) logger.error(err)
    }
    await nvim.command(`silent! call repeat#set("\\<Plug>(coc-cursors-${kind})", -1)`)
  }

  private activate(doc: Document): void {
    if (this._activated) return
    this._activated = true
    this.bufnr = doc.bufnr
    doc.forceSync()
    this.textDocument = doc.textDocument
    doc.onDocumentChange(async e => {
      if (doc.version - this.version == 1) return
      let change = e.contentChanges[0]
      let { text, range } = change
      this._changed = true
      // get range from edit
      let textRange = this.getTextRange(range, text)
      if (!textRange) return this.cancel()
      // calculate & apply changes for all ranges
      this.adjustChange(textRange, range, text)
      let edits = this.ranges.map(o => o.textEdit)
      let content = TextDocument.applyEdits(this.textDocument, edits)
      let newLines = content.split('\n')
      let changedLnum: Set<number> = new Set()
      let arr: [number, string][] = []
      for (let r of this.ranges) {
        if (!changedLnum.has(r.line)) {
          changedLnum.add(r.line)
          arr.push([r.line, newLines[r.line]])
        }
      }

      let { nvim } = this
      this.version = doc.version
      nvim.pauseNotification()
      doc.changeLines(arr)
      // change cursor position when necessary
      let { cursor } = events
      if (textRange.preCount > 0 && cursor.bufnr == this.bufnr && textRange.line + 1 == cursor.lnum) {
        let changed = textRange.preCount * (text.length - (range.end.character - range.start.character))
        nvim.call('cursor', [cursor.lnum, cursor.col + changed], true)
      }
      this.doHighlights()
      let [, err] = await nvim.resumeNotification()
      if (err) logger.error(err)
    }, null, this.disposables)
    doc.onDocumentDetach(e => {
      this.cancel()
    }, null, this.disposables)
    events.on('BufWinEnter', () => {
      this.cancel()
    }, null, this.disposables)
    let { cancelKey, nextKey, previousKey } = this.config
    workspace.registerLocalKeymap('n', cancelKey, () => {
      if (!this._activated) return this.unmap(cancelKey)
      this.cancel()
    }, true)
    workspace.registerLocalKeymap('n', nextKey, async () => {
      if (!this._activated) return this.unmap(nextKey)
      let ranges = this.ranges.map(o => o.currRange)
      let curr = await workspace.getCursorPosition()
      for (let r of ranges) {
        if (comparePosition(r.start, curr) > 0) {
          await workspace.moveTo(r.start)
          return
        }
      }
      if (ranges.length) await workspace.moveTo(ranges[0].start)
    }, true)
    workspace.registerLocalKeymap('n', previousKey, async () => {
      if (!this._activated) return this.unmap(previousKey)
      let ranges = this.ranges.map(o => o.currRange)
      ranges.reverse()
      let curr = await workspace.getCursorPosition()
      for (let r of ranges) {
        if (comparePosition(r.end, curr) < 0) {
          await workspace.moveTo(r.start)
          return
        }
      }
      if (ranges.length) await workspace.moveTo(ranges[0].start)
    }, true)
  }

  private doHighlights(): void {
    let { nvim, matchIds } = this
    if (matchIds.length) {
      nvim.call('coc#util#clearmatches', [matchIds], true)
    }
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !this.ranges.length) return
    let searchRanges = this.ranges.map(o => o.currRange)
    this.matchIds = doc.matchAddRanges(searchRanges, 'CocCursorRange', 999)
  }

  public cancel(): void {
    if (!this._activated) return
    let { nvim, matchIds } = this
    if (matchIds.length) {
      nvim.call('coc#util#clearmatches', [matchIds], true)
    }
    this.matchIds = []
    disposeAll(this.disposables)
    this.disposables = []
    this._changed = false
    this.ranges = []
    this.version = -1
    this._activated = false
  }

  private unmap(key: string): void {
    let { nvim, bufnr } = this
    let { cancelKey, nextKey, previousKey } = this.config
    let escaped = key.startsWith('<') && key.endsWith('>') ? `\\${key}` : key
    nvim.pauseNotification()
    nvim.call('coc#util#unmap', [bufnr, [cancelKey, nextKey, previousKey]], true)
    nvim.call('eval', `feedkeys("${escaped}", 't')`, true)
    nvim.resumeNotification(false, true).logError()
  }

  // sort edits and add them
  public async addRanges(doc: Document, ranges: Range[]): Promise<void> {
    let { nvim } = this
    doc.forceSync()
    this.ranges = []
    ranges.sort((a, b) => comparePosition(a.start, b.start))
    let preCount = 0
    let currline = -1
    for (let range of ranges) {
      let { line } = range.start
      if (line != currline) {
        preCount = 0
      }
      let textRange = new TextRange(line, range.start.character, range.end.character, doc.textDocument.getText(range), preCount)
      this.ranges.push(textRange)
      preCount = preCount + 1
      currline = line
    }
    this.activate(doc)
    nvim.pauseNotification()
    this.doHighlights()
    if (workspace.isVim) {
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) logger.error(err)
  }

  public get activated(): boolean {
    return this._activated
  }

  private getTextRange(range: Range, text: string): TextRange | null {
    let { ranges } = this
    // can't support line count change
    if (text.indexOf('\n') !== -1 || range.start.line != range.end.line) return null
    let textRange = ranges.find(o => rangeIntersect(o.currRange, range))
    if (!textRange) return null
    if (rangeInRange(range, textRange.currRange)) {
      return textRange
    }
    if (range.start.character != range.end.character) {
      // not added
      return null
    }
    if (text.length
      && (range.end.character == textRange.currRange.start.character
        || range.start.character == textRange.currRange.end.character)) {
      return textRange
    }
    return null
  }

  private adjustChange(textRange: TextRange, range: Range, text: string): void {
    let { ranges } = this
    if (range.start.character == range.end.character) {
      // add
      let isEnd = textRange.currRange.end.character == range.start.character
      if (isEnd) {
        ranges.forEach(r => {
          r.add(r.text.length, text)
        })
      } else {
        let d = range.start.character - textRange.currRange.start.character
        ranges.forEach(r => {
          r.add(Math.min(r.text.length, d), text)
        })
      }
    } else {
      // replace
      let d = range.end.character - range.start.character
      let isEnd = textRange.currRange.end.character == range.end.character
      if (isEnd) {
        if (textRange.currRange.start.character == range.start.character) {
          // changed both start and end
          if (text.indexOf(textRange.text) !== -1) {
            let idx = text.indexOf(textRange.text)
            let pre = idx == 0 ? '' : text.slice(0, idx)
            let post = text.slice(idx + textRange.text.length)
            if (pre) ranges.forEach(r => r.add(0, pre))
            if (post) ranges.forEach(r => r.add(r.text.length, post))
          } else if (textRange.text.indexOf(text) !== -1) {
            // delete
            let idx = textRange.text.indexOf(text)
            let offset = textRange.text.length - (idx + text.length)
            if (idx != 0) ranges.forEach(r => r.replace(0, idx))
            if (offset > 0) ranges.forEach(r => r.replace(r.text.length - offset, r.text.length))
          } else {
            this.cancel()
          }
        } else {
          ranges.forEach(r => {
            let l = r.text.length
            r.replace(Math.max(0, l - d), l, text)
          })
        }
      } else {
        let start = range.start.character - textRange.currRange.start.character
        ranges.forEach(r => {
          let l = r.text.length
          r.replace(start, Math.min(start + d, l), text)
        })
      }
    }
  }

  private addRange(range: Range, text: string): void {
    let { ranges } = this
    let idx = ranges.findIndex(o => rangeIntersect(o.range, range))
    // remove range when intersect
    if (idx !== -1) {
      ranges.splice(idx, 1)
      // adjust preCount after
      for (let r of ranges) {
        if (r.line == range.start.line && r.start > range.start.character) {
          r.preCount = r.preCount - 1
        }
      }
    } else {
      let preCount = 0
      let idx = 0
      let { line } = range.start
      // idx & preCount
      for (let r of ranges) {
        if (r.line > line || (r.line == line && r.start > range.end.character)) {
          break
        }
        if (r.line == line) preCount++
        idx++
      }
      let created = new TextRange(line, range.start.character, range.end.character, text, preCount)
      ranges.splice(idx, 0, created)
      // adjust preCount after
      for (let r of ranges) {
        if (r.line == range.start.line && r.start > range.start.character) {
          r.preCount = r.preCount + 1
        }
      }
    }
  }
}
