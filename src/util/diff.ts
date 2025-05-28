'use strict'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { fastDiff } from './node'
import { emptyRange, getEnd, positionInRange } from './position'
import { byteLength } from './string'

export interface ChangedLines {
  start: number
  end: number
  replacement: string[]
}

export function diffLines(oldLines: ReadonlyArray<string>, newLines: ReadonlyArray<string>, startLine: number): ChangedLines {
  let endOffset = 0
  let startOffset = 0
  let parts = oldLines.slice(startLine + 1)
  for (let i = 0; i < Math.min(parts.length, newLines.length); i++) {
    if (parts[parts.length - 1 - i] == newLines[newLines.length - 1 - i]) {
      endOffset = endOffset + 1
    } else {
      break
    }
  }
  for (let i = 0; i <= Math.min(startLine, newLines.length - 1 - endOffset); i++) {
    if (oldLines[i] == newLines[i]) {
      startOffset = startOffset + 1
    } else {
      break
    }
  }
  let replacement = newLines.slice(startOffset, newLines.length - endOffset)
  let end = oldLines.length - endOffset
  if (end > startOffset && replacement.length) {
    let offset = 0
    for (let i = 0; i < Math.min(replacement.length, end - startOffset); i++) {
      if (replacement[i] == oldLines[startOffset + i]) {
        offset = offset + 1
      } else {
        break
      }
    }
    if (offset) {
      return {
        start: startOffset + offset,
        end,
        replacement: replacement.slice(offset)
      }
    }
  }
  return {
    start: startOffset,
    end,
    replacement
  }
}

export function patchLine(from: string, to: string, fill = ' '): string {
  if (from == to) return to
  let idx = to.indexOf(from)
  if (idx !== -1) return fill.repeat(byteLength(to.substring(0, idx))) + from
  let result = fastDiff(from, to)
  let str = ''
  for (let item of result) {
    if (item[0] == fastDiff.DELETE) {
      // not allowed
      return to
    } else if (item[0] == fastDiff.INSERT) {
      str = str + fill.repeat(byteLength(item[1]))
    } else {
      str = str + item[1]
    }
  }
  return str
}

export function getTextEdit(oldLines: ReadonlyArray<string>, newLines: ReadonlyArray<string>, cursor?: Position, insertMode?: boolean): TextEdit | undefined {
  let ol = oldLines.length
  let nl = newLines.length
  let n: number
  if (cursor) {
    // consider new line insert
    n = nl > ol && insertMode && cursor.line > 0 ? cursor.line - 1 : cursor.line
  } else {
    n = Math.min(ol, nl)
  }
  let used = 0
  for (let i = 0; i < n; i++) {
    if (newLines[i] === oldLines[i]) {
      used += 1
    } else {
      break
    }
  }
  if (ol == nl && used == ol) return undefined
  let delta = nl - ol
  let r = Math.min(ol - used, nl - used)
  let e = 0
  for (let i = 0; i < r; i++) {
    if (newLines[nl - i - 1] === oldLines[ol - i - 1]) {
      e += 1
    } else {
      break
    }
  }
  let inserted = e == 0 ? newLines.slice(used) : newLines.slice(used, -e)
  if (delta == 0 && cursor && inserted.length == 1) {
    let newLine = newLines[used]
    let oldLine = oldLines[used]
    let nl = newLine.length
    let ol = oldLine.length
    if (nl === 0) return TextEdit.del(Range.create(used, 0, used, ol))
    if (ol === 0) return TextEdit.insert(Position.create(used, 0), newLine)
    let character = Math.min(cursor.character, nl)
    if (!insertMode && nl >= ol && character !== nl) {
      // insert text
      character += 1
    }
    let r = 0
    for (let i = 0; i < nl - character; i++) {
      let idx = ol - 1 - i
      if (idx === -1) break
      if (newLine[nl - 1 - i] === oldLine[idx]) {
        r += 1
      } else {
        break
      }
    }
    let l = 0
    for (let i = 0; i < Math.min(ol - r, nl - r); i++) {
      if (newLine[i] === oldLine[i]) {
        l += 1
      } else {
        break
      }
    }
    let newText = r === 0 ? newLine.slice(l) : newLine.slice(l, -r)
    return TextEdit.replace(Range.create(used, l, used, ol - r), newText)
  }
  let text = inserted.length > 0 ? inserted.join('\n') + '\n' : ''
  if (text.length === 0 && used === ol - e) return undefined
  let original = oldLines.slice(used, ol - e).join('\n') + '\n'
  let edit = TextEdit.replace(Range.create(used, 0, ol - e, 0), text)
  return reduceReplaceEdit(edit, original, cursor)
}

export function getCommonSuffixLen(a: string, b: string, max: number): number {
  if (max === 0) return 0
  let al = a.length
  let bl = b.length
  let n = 0
  for (let i = 0; i < max; i++) {
    if (a[al - 1 - i] === b[bl - 1 - i]) {
      n++
    } else {
      break
    }
  }
  return n
}

export function getCommonPrefixLen(a: string, b: string, max: number): number {
  if (max === 0) return 0
  let n = 0
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      n++
    } else {
      break
    }
  }
  return n
}

export function reduceReplaceEdit(edit: TextEdit, original: string, cursor?: Position): TextEdit {
  let { newText, range } = edit
  if (emptyRange(range) || newText === '') return edit
  // let isAdd = newText.length > original.length
  let endOffset: number | undefined
  if (cursor) {
    let newEnd = getEnd(range.start, newText)
    if (positionInRange(cursor, Range.create(range.start, newEnd)) === 0) {
      endOffset = 0
      let lc = newEnd.line - cursor.line + 1
      let lines = newText.split('\n')
      let len = lines.length
      for (let i = 0; i < lc; i++) {
        let idx = len - i - 1
        if (i == lc - 1) {
          let s = idx === 0 ? range.start.character : 0
          endOffset += lines[idx].slice(cursor.character - s).length
        } else {
          endOffset += lines[idx].length + 1
        }
      }
    }
  }
  let sl: number
  let pl: number
  let min = Math.min(original.length, newText.length)
  if (endOffset) {
    sl = getCommonSuffixLen(original, newText, endOffset)
    pl = getCommonPrefixLen(original, newText, min - sl)
  } else {
    pl = getCommonPrefixLen(original, newText, min)
    sl = getCommonSuffixLen(original, newText, min - pl)
  }
  let s = pl === 0 ? range.start : getEnd(range.start, original.slice(0, pl))
  let e = sl === 0 ? range.end : getEnd(range.start, original.slice(0, -sl))
  let text = newText.slice(pl, sl === 0 ? undefined : -sl)
  return TextEdit.replace(Range.create(s, e), text)
}
