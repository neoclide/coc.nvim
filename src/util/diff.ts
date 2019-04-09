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
    for (let j = oldLen; j >= 0; j--) {
      if (j < start) {
        end = start
        break
      }
      if (oldLines[j - 1] !== newLines[len - (oldLen - j) - 1]) {
        end = j
        break
      }
      if (j == 0) {
        end = 0
      }
    }
  }
  return {
    start,
    end,
    replacement: newLines.slice(start, len - (oldLen - end))
  }
}

export function getChange(oldStr: string, newStr: string): Change {
  let start = 0
  let ol = oldStr.length
  let nl = newStr.length
  let max = Math.min(ol, nl)
  let newText = ''
  let endOffset = 0
  for (let i = 0; i <= max; i++) {
    if (oldStr[ol - i - 1] != newStr[nl - i - 1]) {
      endOffset = i
      break
    }
    if (i == max) return null
  }
  max = max - endOffset
  if (max == 0) {
    start = 0
  } else {
    for (let i = 0; i <= max; i++) {
      if (oldStr[i] != newStr[i] || i == max) {
        start = i
        break
      }
    }
  }
  let end = ol - endOffset
  newText = newStr.slice(start, nl - endOffset)
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
