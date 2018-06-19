import {IDiffResult} from 'diff'
import {
  ChangedLines
} from '../types'
import diff = require('diff')

export function diffLines(from:string, to:string):ChangedLines {
  let diffs:IDiffResult[] = diff.diffLines(from, to)
  let change:any = {}
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
