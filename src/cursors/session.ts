import { Buffer, Neovim } from '@chemzqm/neovim'
import fastDiff from 'fast-diff'
import { Disposable, Emitter, Event, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import events from '../events'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { comparePosition, emptyRange, positionInRange, rangeInRange, rangeIntersect, rangeOverlap } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import TextRange from './range'
import { adjustPosition, equalEdit } from './util'
const logger = require('../util/logger')('cursors-session')

export interface Config {
  cancelKey: string
  previousKey: string
  nextKey: string
}

/**
 * Cursor session for single buffer
 */
export default class CursorSession {
  private readonly _onDidCancel = new Emitter<void>()
  public readonly onDidCancel: Event<void> = this._onDidCancel.event
  private disposables: Disposable[] = []
  private ranges: TextRange[] = []
  private activated = true
  private changing = false
  private changed = false
  private textDocument: TextDocument
  constructor(
    private nvim: Neovim,
    private doc: Document,
    private config: Config) {
    this.doc.forceSync()
    this.textDocument = this.doc.textDocument
    this.buffer.setVar('coc_cursors_activated', 1, true)
    let { cancelKey, nextKey, previousKey } = this.config
    this.disposables.push(workspace.registerLocalKeymap('n', cancelKey, () => {
      this.cancel()
    }, true))
    this.disposables.push(workspace.registerLocalKeymap('n', nextKey, async () => {
      if (!this.activated) return
      let ranges = this.ranges.map(o => o.currRange)
      let curr = await window.getCursorPosition()
      for (let r of ranges) {
        if (comparePosition(r.start, curr) > 0) {
          await window.moveTo(r.start)
          return
        }
      }
      if (ranges.length) await window.moveTo(ranges[0].start)
    }, true))
    this.disposables.push(workspace.registerLocalKeymap('n', previousKey, async () => {
      if (!this.activated) return
      let ranges = this.ranges.map(o => o.currRange)
      ranges.reverse()
      let curr = await window.getCursorPosition()
      for (let r of ranges) {
        if (comparePosition(r.end, curr) < 0) {
          await window.moveTo(r.start)
          return
        }
      }
      if (ranges.length) await window.moveTo(ranges[ranges.length - 1].start)
    }, true))
    this.doc.onDocumentChange(this.onChange, this, this.disposables)
  }

  private async onChange(e: DidChangeTextDocumentParams): Promise<void> {
    if (!this.activated || this.ranges.length == 0) return
    if (this.changing) return
    let change = e.contentChanges[0]
    let { text, range } = change
    let intersect = this.ranges.some(r => rangeIntersect(range, r.currRange))
    let begin = this.ranges[0].currRange.start
    if (text.endsWith('\n') && comparePosition(begin, range.end) == 0) {
      // prepend lines
      intersect = false
    }
    if (!intersect) {
      this.ranges.forEach(r => {
        r.adjustFromEdit({ range, newText: text })
      })
      this.doHighlights()
      this.textDocument = this.doc.textDocument
      return
    }
    this.changed = true
    // get range from edit
    let textRange = this.getTextRange(range, text)
    if (textRange) {
      await this.applySingleEdit(textRange, { range, newText: text })
    } else {
      this.applyComposedEdit(e.original, { range, newText: text })
      if (this.activated) {
        this.ranges.forEach(r => {
          r.sync()
        })
        this.textDocument = this.doc.textDocument
      }
    }
  }

  private doHighlights(): void {
    let { nvim, buffer, ranges } = this
    buffer.clearNamespace('cursors')
    let arr = ranges.map(o => o.currRange)
    buffer.highlightRanges('cursors', 'CocCursorRange', arr)
    nvim.command('redraw', true)
  }

  public addRanges(ranges: Range[]): boolean {
    let { nvim, doc } = this
    if (this.changed) {
      window.showMessage(`Can't add ranges after range change.`)
      return false
    }
    // filter overlap ranges
    this.ranges = this.ranges.filter(r => {
      let { currRange } = r
      return !ranges.some(range => rangeOverlap(range, currRange))
    })
    let { textDocument } = doc
    for (let range of ranges) {
      let { line } = range.start
      let textRange = new TextRange(line, range.start.character, range.end.character, textDocument.getText(range), 0)
      this.ranges.push(textRange)
    }
    this.ranges.sort((a, b) => comparePosition(a.range.start, b.range.start))
    // fix preCount
    let preCount = 0
    let currline = -1
    for (let range of this.ranges) {
      let { line } = range
      if (line != currline) {
        preCount = 0
      }
      range.preCount = preCount
      preCount = preCount + 1
      currline = line
    }
    nvim.pauseNotification()
    this.doHighlights()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    return true
  }

  /**
   * Cancel session and highlights
   */
  public cancel(): void {
    if (!this.activated) return
    let { nvim } = this
    this.activated = false
    let { cancelKey, nextKey, previousKey } = this.config
    nvim.pauseNotification()
    this.buffer.clearNamespace('cursors')
    this.buffer.setVar('coc_cursors_activated', 0, true)
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    this._onDidCancel.fire()
  }

  /**
   * Called on buffer unload or cancel
   */
  public dispose(): void {
    if (!this.doc) return
    this._onDidCancel.dispose()
    for (let disposable of this.disposables) {
      disposable.dispose()
    }
    this.ranges = []
    this.doc = null
    this.textDocument = null
  }

  private get buffer(): Buffer {
    return this.nvim.createBuffer(this.doc.bufnr)
  }

  /**
   * Find changed range from edit
   */
  private getTextRange(range: Range, text: string): TextRange | null {
    let { ranges } = this
    if (text.indexOf('\n') !== -1 || range.start.line != range.end.line) {
      return null
    }
    ranges.sort((a, b) => {
      if (a.line != b.line) return a.line - b.line
      return a.currRange.start.character - b.currRange.start.character
    })
    for (let i = 0; i < ranges.length; i++) {
      let r = ranges[i]
      if (rangeInRange(range, r.currRange)) {
        return r
      }
      if (r.line != range.start.line) {
        continue
      }
      if (text.length && range.start.character == r.currRange.end.character) {
        // end add
        let next = ranges[i + 1]
        if (!next) return r
        return positionInRange(next.currRange.start, range) ? null : r
      }
    }
    return null
  }

  /**
   * Adjust change for current ranges
   */
  private adjustRanges(textRange: TextRange, range: Range, text: string): void {
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
          if (text.includes(textRange.text)) {
            let idx = text.indexOf(textRange.text)
            let pre = idx == 0 ? '' : text.slice(0, idx)
            let post = text.slice(idx + textRange.text.length)
            if (pre) ranges.forEach(r => r.add(0, pre))
            if (post) ranges.forEach(r => r.add(r.text.length, post))
          } else if (textRange.text.includes(text)) {
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

  public addRange(range: Range, text: string): void {
    if (this.changed) {
      window.showMessage(`Can't add range after range change.`)
      return
    }
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
    if (this.ranges.length == 0) {
      this.cancel()
    } else {
      this.doHighlights()
    }
  }

  private async applySingleEdit(textRange: TextRange, edit: TextEdit): Promise<void> {
    // single range change, calculate & apply changes for all ranges
    let { range, newText } = edit
    let { doc } = this
    this.adjustRanges(textRange, range, newText)
    if (this.ranges.length == 1) {
      this.doHighlights()
      return
    }
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
    this.changing = true
    await doc.changeLines(arr)
    this.changing = false
    if (this.activated) {
      this.ranges.forEach(r => {
        r.sync()
      })
      this.textDocument = this.doc.textDocument
    }
    // apply changes
    nvim.pauseNotification()
    let { cursor } = events
    if (textRange.preCount > 0 && cursor.bufnr == doc.bufnr && textRange.line + 1 == cursor.lnum) {
      let changed = textRange.preCount * (newText.length - (range.end.character - range.start.character))
      nvim.call('cursor', [cursor.lnum, cursor.col + changed], true)
    }
    this.doHighlights()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  private applyComposedEdit(original: string, edit: TextEdit): void {
    // check complex edit
    let { range, newText } = edit
    let { ranges } = this
    let doc = TextDocument.create('file:///1', '', 0, original)
    let edits: TextEdit[] = []
    let diffs = fastDiff(original, newText)
    let offset = 0
    for (let i = 0; i < diffs.length; i++) {
      let diff = diffs[i]
      let pos = adjustPosition(range.start, doc.positionAt(offset))
      if (diff[0] == fastDiff.EQUAL) {
        offset = offset + diff[1].length
      } else if (diff[0] == fastDiff.DELETE) {
        let end = adjustPosition(range.start, doc.positionAt(offset + diff[1].length))
        if (diffs[i + 1] && diffs[i + 1][0] == fastDiff.INSERT) {
          // change
          edits.push({ range: Range.create(pos, end), newText: diffs[i + 1][1] })
          i = i + 1
        } else {
          // delete
          edits.push({ range: Range.create(pos, end), newText: '' })
        }
        offset = offset + diff[1].length
      } else if (diff[0] == fastDiff.INSERT) {
        edits.push({ range: Range.create(pos, pos), newText: diff[1] })
      }
    }
    if (edits.some(edit => edit.newText.includes('\n') || edit.range.start.line != edit.range.end.line)) {
      this.cancel()
      return
    }
    if (edits.length == ranges.length) {
      let last: TextEdit
      for (let i = 0; i < edits.length; i++) {
        let edit = edits[i]
        let textRange = this.ranges[i]
        if (!rangeIntersect(textRange.currRange, edit.range)) {
          this.cancel()
          return
        }
        if (last && !equalEdit(edit, last)) {
          this.cancel()
          return
        }
        textRange.applyEdit(edit)
        last = edit
      }
    } else if (edits.length == ranges.length * 2) {
      for (let i = 0; i < edits.length - 1; i = i + 2) {
        let edit = edits[i]
        let next = edits[i + 1]
        if (edit.newText.length == 0 && next.newText.length == 0) {
          // remove begin & end
          let textRange = this.ranges[i / 2]
          if (comparePosition(textRange.currRange.end, next.range.end) != 0) {
            this.cancel()
            return
          }
          let start = edit.range.start.character - textRange.currRange.start.character
          textRange.replace(start, edit.range.end.character - edit.range.start.character, '')
          let offset = next.range.end.character - next.range.start.character
          let len = textRange.text.length
          textRange.replace(len - offset, len)
        } else if (emptyRange(edit.range) && emptyRange(next.range)) {
          // add begin & end
          let textRange = this.ranges[i / 2]
          if (comparePosition(textRange.currRange.end, next.range.start) != 0) {
            this.cancel()
            return
          }
          let start = edit.range.start.character - textRange.currRange.start.character
          textRange.add(start, edit.newText)
          let len = textRange.text.length
          textRange.add(len, next.newText)
        } else {
          this.cancel()
          return
        }
      }
    } else {
      this.cancel()
      return
    }
    this.doHighlights()
  }
}
