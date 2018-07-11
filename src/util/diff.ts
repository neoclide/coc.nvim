import diff, {IDiffResult} from 'diff'
import fastDiff from 'fast-diff'
import {ChangedLines, ChangeItem} from '../types'
const logger = require('./logger')('util-diff')

interface Change {
  start: number
  end: number
  newText: string
}

export function diffLines(from: string, to: string): ChangedLines {
  let diffs: IDiffResult[] = diff.diffLines(from, to)
  let change: any = {}
  let lnum = 0
  for (let diff of diffs) {
    if (diff.removed) {
      if (change.removed) return null
      change.removed = diff.value
      change.removeCount = diff.count
      change.lnum = lnum
    }
    if (diff.added) {
      if (change.added || (change.lnum && change.lnum != lnum)) {
        return null
      }
      change.added = diff.value
      change.lnum = lnum
    }
    if (!diff.removed) {
      lnum = lnum + diff.count
    }
  }
  if (!change.added && !change.removed) return null
  let lines = []
  if (change.added) {
    lines = change.added.slice(0, -1).split('\n')
  }
  return {
    start: change.lnum,
    end: change.lnum + (change.removeCount || 0),
    replacement: lines,
  }
}

export function getChangeItem(oldStr: string, newStr: string): ChangeItem {
  let change = getChange(oldStr, newStr)
  if (!change) return
  let {start, end} = change
  return {
    offset: change.start,
    added: change.newText,
    removed: oldStr.slice(start, end)
  }
}

export function getChange(oldStr: string, newStr: string): Change {
  if (oldStr == newStr) return null
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
  return {start, end, newText}
}
