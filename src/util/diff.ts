import fastDiff from 'fast-diff'
import { Range, TextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol'
import { ChangedLines } from '../types'
import { byteLength } from './string'
const logger = require('./logger')('util-diff')

interface Change {
  start: number
  end: number
  newText: string
}

export function diffLines(from: string, to: string): ChangedLines {
  let newLines: string[] = to.split('\n')
  let oldLines: string[] = from.split('\n')
  let start = 0
  let end = oldLines.length
  let oldLen = end
  let len = newLines.length
  for (let i = 0; i <= end; i++) {
    if (newLines[i] !== oldLines[i]) {
      start = i
      break
    }
    if (i == end) {
      start = end
    }
  }
  if (start != newLines.length) {
    let maxRemain = Math.min(end - start, len - start)
    for (let j = 0; j < maxRemain; j++) {
      if (oldLines[oldLen - j - 1] != newLines[len - j - 1]) {
        break
      }
      end = end - 1
    }
  }
  return {
    start,
    end,
    replacement: newLines.slice(start, len - (oldLen - end))
  }
}

export function getChange(oldStr: string, newStr: string, cursorEnd?: number): Change {
  let start = 0
  let ol = oldStr.length
  let nl = newStr.length
  let max = Math.min(ol, nl)
  let newText = ''
  let endOffset = -1
  let maxEndOffset = -1
  for (let i = 0; i <= max; i++) {
    if (cursorEnd != null && i == cursorEnd) {
      endOffset = i
    }
    if (oldStr[ol - i - 1] != newStr[nl - i - 1]) {
      if (endOffset == -1) endOffset = i
      maxEndOffset = i
      break
    }
  }
  if (endOffset == -1) return null
  let remain = max - endOffset
  if (remain == 0) {
    start = 0
  } else {
    for (let i = 0; i <= remain; i++) {
      if (oldStr[i] != newStr[i] || i == remain) {
        start = i
        break
      }
    }
  }
  if (maxEndOffset != -1
    && maxEndOffset != endOffset
    && start + maxEndOffset < max) {
    endOffset = maxEndOffset
  }
  let end = ol - endOffset
  newText = newStr.slice(start, nl - endOffset)
  if (ol == nl && start == end) return null
  // optimize for add new line(s)
  if (start == end) {
    let pre = start == 0 ? '' : newStr[start - 1]
    if (pre && pre != '\n'
      && oldStr[start] == '\n'
      && newText.startsWith('\n')) {
      return { start: start + 1, end: end + 1, newText: newText.slice(1) + '\n' }
    }
  }
  return { start, end, newText }
}

export function patchLine(from: string, to: string, fill = ' '): string {
  if (from == to) return to
  let idx = to.indexOf(from)
  if (idx !== -1) return fill.repeat(idx) + from
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
