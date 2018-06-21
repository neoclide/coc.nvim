import {IDiffResult} from 'diff'
import {
  ChangedLines,
  ChangeItem,
} from '../types'
import diff = require('diff')
import {TextDocument, TextEdit} from 'vscode-languageserver-protocol'

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

// get TextEdit from two textDocument
export function getTextEdit(orig:TextDocument, curr:TextDocument):TextEdit {
  let oldStr = orig.getText()
  let newStr = curr.getText()
  if (oldStr == newStr) return null
  let diffs = diff.diffChars(oldStr, newStr)
  let start = -1
  let end = -1
  let offset = 0
  let currOffset = 0
  let currEnd = -1
  for (let diff of diffs) {
    if (start == -1 && (diff.added || diff.removed)) {
      start = offset
    }
    if (diff.removed) {
      end = offset + diff.count
      currEnd = currOffset
    }
    if (diff.added) {
      end = offset
      currEnd = currOffset + diff.count
    }
    if (!diff.added) {
      offset = offset + diff.count
    }
    if (!diff.removed) {
      currOffset = currOffset + diff.count
    }
  }
  if (start == -1 || end == -1) return null
  return {
    range: {
      start: orig.positionAt(start),
      end: orig.positionAt(end),
    },
    newText: newStr.slice(start, currEnd)
  }
}

export function applyChangeItem(oldStr:string, item:ChangeItem):string {
  let {offset, added, removed} = item
  let text = oldStr.slice(offset)
  if (removed) text = text.slice(removed.length)
  if (added) text = added + text
  return oldStr.slice(0, offset) + text
}

export function getChangeItem(oldStr:string, newStr:string):ChangeItem {
  if (oldStr == newStr) return null
  let diffs = diff.diffChars(oldStr, newStr)
  let start = -1
  let end = -1
  let offset = 0
  let currOffset = 0
  let currEnd = -1
  for (let diff of diffs) {
    if (start == -1 && (diff.added || diff.removed)) {
      start = offset
    }
    if (diff.removed) {
      end = offset + diff.count
      currEnd = currOffset
    }
    if (diff.added) {
      end = offset
      currEnd = currOffset + diff.count
    }
    if (!diff.added) {
      offset = offset + diff.count
    }
    if (!diff.removed) {
      currOffset = currOffset + diff.count
    }
  }
  if (start == -1 || end == -1) return null
  return {
    offset: start,
    added: newStr.slice(start, currEnd),
    removed: oldStr.slice(start, end)
  }
}
