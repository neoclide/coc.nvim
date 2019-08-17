import { Neovim } from '@chemzqm/neovim'
import fastDiff from 'fast-diff'
import debounce from 'debounce'
import { Disposable } from 'vscode-jsonrpc'
import { Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import Document from '../model/document'
import { disposeAll } from '../util'
import { distinct } from '../util/array'
import { comparePosition, rangeInRange, rangeIntersect, rangeOverlap, positionInRange, emptyRange } from '../util/position'
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
    this.loadConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('cursors')) {
        this.loadConfig()
      }
    })
  }

  private loadConfig(): void {
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
    doc.forceSync()
    let { nvim } = this
    if (this._changed || bufnr != this.bufnr) {
      this.cancel()
    }
    let pos = await workspace.getCursorPosition()
    let range: Range
    if (kind == 'operator') {
      await nvim.command(`normal! ${mode == 'line' ? `'[` : '`['}`)
      let start = await workspace.getCursorPosition()
      await nvim.command(`normal! ${mode == 'line' ? `']` : '`]'}`)
      let end = await workspace.getCursorPosition()
      await workspace.moveTo(pos)
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
        this.addRange(r, text)
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
      this.addRange(range, text)
    } else if (kind == 'position') {
      // make sure range contains character for highlight
      let line = doc.getline(pos.line)
      if (pos.character >= line.length) {
        range = Range.create(pos.line, line.length - 1, pos.line, line.length)
      } else {
        range = Range.create(pos.line, pos.character, pos.line, pos.character + 1)
      }
      this.addRange(range, line.slice(range.start.character, range.end.character))
    } else if (kind == 'range') {
      await nvim.call('eval', 'feedkeys("\\<esc>", "in")')
      let range = await workspace.getSelectedRange(mode, doc)
      if (!range || comparePosition(range.start, range.end) == 0) return
      let ranges = mode == '\x16' ? getVisualRanges(doc, range) : splitRange(doc, range)
      for (let r of ranges) {
        let text = doc.textDocument.getText(r)
        this.addRange(r, text)
      }
    } else {
      workspace.showMessage(`${kind} not supported`, 'error')
      return
    }
    if (this._activated && !this.ranges.length) {
      this.cancel()
    } else if (this.ranges.length && !this._activated) {
      let winid = await nvim.call('win_getid')
      this.activate(doc, winid)
    }
    if (this._activated) {
      nvim.pauseNotification()
      this.doHighlights()
      let [, err] = await nvim.resumeNotification()
      if (err) logger.error(err)
    }
    if (kind == 'word' || kind == 'position') {
      await nvim.command(`silent! call repeat#set("\\<Plug>(coc-cursors-${kind})", -1)`)
    }
  }

  private activate(doc: Document, winid): void {
    if (this._activated) return
    this._activated = true
    this.bufnr = doc.bufnr
    this.winid = winid
    this.nvim.setVar('coc_cursors_activated', 1, true)
    doc.forceSync()
    this.textDocument = doc.textDocument
    workspace.onDidChangeTextDocument(async e => {
      if (e.textDocument.uri != doc.uri) return
      if (doc.version - this.version == 1 || !this.ranges.length) return
      let change = e.contentChanges[0]
      let { original } = e
      let { text, range } = change
      // ignore change after last range
      if (comparePosition(range.start, this.lastPosition) > 0) {
        if (this._changed) {
          this.cancel()
        } else {
          this.textDocument = doc.textDocument
        }
        return
      }
      let changeCount = text.split('\n').length - (range.end.line - range.start.line + 1)
      // adjust line when change before first position
      let d = comparePosition(range.end, this.firstPosition)
      if (d < 0 || d == 0 && (comparePosition(range.start, range.end) != 0 || text.endsWith('\n'))) {
        if (this._changed) {
          this.cancel()
        } else {
          if (changeCount != 0) this.ranges.forEach(r => r.line = r.line + changeCount)
          this.textDocument = doc.textDocument
        }
        return
      }
      // ignore changes when not overlap
      if (changeCount == 0) {
        let lnums = distinct(this.ranges.map(r => r.line))
        let startLine = range.start.line
        let endLine = range.end.line
        let overlap = lnums.some(line => line >= startLine && line <= endLine)
        if (!overlap) return
      }
      this._changed = true
      // get range from edit
      let textRange = this.getTextRange(range, text)
      if (textRange) {
        await this.applySingleEdit(textRange, { range, newText: text })
      } else {
        await this.applyComposedEdit(original, { range, newText: text })
      }
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
    events.on('CursorMoved', debounce(async bufnr => {
      if (bufnr != this.bufnr) return this.cancel()
      let winid = await this.nvim.call('win_getid')
      if (winid != this.winid) {
        this.cancel()
      }
    }, 100), null, this.disposables)
  }

  private doHighlights(): void {
    let { matchIds } = this
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !this.ranges.length) return
    if (matchIds.length) this.nvim.call('coc#util#clearmatches', [matchIds, this.winid], true)
    let searchRanges = this.ranges.map(o => o.currRange)
    this.matchIds = doc.matchAddRanges(searchRanges, 'CocCursorRange', 99)
    if (workspace.isVim) this.nvim.command('redraw', true)
  }

  public cancel(): void {
    if (!this._activated) return
    let { matchIds } = this
    this.nvim.setVar('coc_cursors_activated', 0, true)
    this.nvim.call('coc#util#clearmatches', [Array.from(matchIds), this.winid], true)
    this.matchIds = []
    disposeAll(this.disposables)
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

  // Add ranges to current document
  public async addRanges(ranges: Range[]): Promise<void> {
    let { nvim } = this
    let [bufnr, winid] = await nvim.eval('[bufnr("%"),win_getid()]') as [number, number]
    if (this._activated && (this.bufnr != bufnr || this.winid != winid)) {
      this.cancel()
    }
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    doc.forceSync()
    // filter overlap ranges
    if (!this._changed) {
      this.ranges = this.ranges.filter(r => {
        let { currRange } = r
        return !ranges.some(range => rangeOverlap(range, currRange))
      })
    } else {
      // use new ranges
      this.ranges = []
    }
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
    if (!this.ranges.length) return
    this.activate(doc, winid)
    nvim.pauseNotification()
    this.doHighlights()
    let [, err] = await nvim.resumeNotification()
    if (err) logger.error(err)
  }

  public get activated(): boolean {
    return this._activated
  }

  /**
   * Find single range from edit
   */
  private getTextRange(range: Range, text: string): TextRange | null {
    let { ranges } = this
    // can't support line count change
    if (text.indexOf('\n') !== -1 || range.start.line != range.end.line) return null
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

  private async applySingleEdit(textRange: TextRange, edit: TextEdit): Promise<void> {
    // single range change, calculate & apply changes for all ranges
    let { range, newText } = edit
    let doc = workspace.getDocument(this.bufnr)
    this.adjustChange(textRange, range, newText)
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
    this.version = doc.version
    // apply changes
    nvim.pauseNotification()
    nvim.command('undojoin', true)
    doc.changeLines(arr)
    let { cursor } = events
    if (textRange.preCount > 0 && cursor.bufnr == this.bufnr && textRange.line + 1 == cursor.lnum) {
      let changed = textRange.preCount * (newText.length - (range.end.character - range.start.character))
      nvim.call('cursor', [cursor.lnum, cursor.col + changed], true)
    }
    this.doHighlights()
    let [, err] = await nvim.resumeNotification()
    if (err) logger.error(err)
  }

  private async applyComposedEdit(original: string, edit: TextEdit): Promise<void> {
    // check complex edit
    let { range, newText } = edit
    let { nvim, ranges } = this
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
    if (edits.some(edit => edit.newText.indexOf('\n') != -1 || edit.range.start.line != edit.range.end.line)) {
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
        }
      }
    } else {
      this.cancel()
    }
    nvim.pauseNotification()
    this.doHighlights()
    await nvim.resumeNotification(false, true)
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

  private get lastPosition(): Position {
    let { ranges } = this
    let r = ranges[ranges.length - 1]
    return r.currRange.end
  }

  private get firstPosition(): Position {
    let { ranges } = this
    return ranges[0].currRange.start
  }
}

function splitRange(doc: Document, range: Range): Range[] {
  let splited: Range[] = []
  for (let i = range.start.line; i <= range.end.line; i++) {
    let curr = doc.getline(i) || ''
    let sc = i == range.start.line ? range.start.character : 0
    let ec = i == range.end.line ? range.end.character : curr.length
    if (sc == ec) continue
    splited.push(Range.create(i, sc, i, ec))
  }
  return splited
}

/**
 * Get ranges of visual block
 */
function getVisualRanges(doc: Document, range: Range): Range[] {
  let { start, end } = range
  if (start.line > end.line) {
    [start, end] = [end, start]
  }
  let sc = start.character < end.character ? start.character : end.character
  let ec = start.character < end.character ? end.character : start.character
  let ranges: Range[] = []
  for (let i = start.line; i <= end.line; i++) {
    let line = doc.getline(i)
    ranges.push(Range.create(i, sc, i, Math.min(line.length, ec)))
  }
  return ranges
}

function adjustPosition(position: Position, delta: Position): Position {
  let { line, character } = delta
  return Position.create(position.line + line, line == 0 ? position.character + character : character)
}

function equalEdit(one: TextEdit, two: TextEdit): boolean {
  if (one.newText.length != two.newText.length) return false
  let { range } = one
  if (range.end.character - range.start.character != two.range.end.character - two.range.start.character) {
    return false
  }
  return true
}
