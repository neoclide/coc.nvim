import fastDiff from 'fast-diff'
import { ChangedLines, ChangeItem } from '../types'
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
  return {
    start,
    end,
    replacement: newLines.slice(start, len - (oldLen - end))
  }
}

export function getChangeItem(oldStr: string, newStr: string): ChangeItem {
  let change = getChange(oldStr, newStr)
  if (!change) return null
  let { start, end } = change
  return {
    offset: change.start,
    added: change.newText,
    removed: oldStr.slice(start, end)
  }
}

export function getChange(oldStr: string, newStr: string): Change {
  let result = fastDiff(oldStr, newStr, 1)
  let curr = 0
  let start = -1
  let end = -1
  let newText = ''
  let remain = ''
  for (let item of result) {
    let [t, str] = item
    // equal
    if (t == 0) {
      curr = curr + str.length
      if (start != -1) remain = remain + str
    } else {
      if (start == -1) start = curr
      if (t == 1) {
        newText = newText + remain + str
        end = curr
      } else {
        newText = newText + remain
        end = curr + str.length
      }
      remain = ''
      if (t == -1) curr = curr + str.length
    }
  }
  return { start, end, newText }
}
