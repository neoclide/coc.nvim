'use strict'
import { AnnotatedTextEdit, ChangeAnnotation, Position, Range, SnippetTextEdit, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { LinesTextDocument } from '../model/textdocument'
import { DocumentChange } from '../types'
import { isFalsyOrEmpty } from './array'
import { diffLines } from './diff'
import { equals, toObject } from './object'
import { comparePosition, emptyRange, getEnd, samePosition, toValidRange } from './position'
import { byteIndex, contentToLines, toText } from './string'

export type TextChangeItem = [string[], number, number, number, number]

export function getStartLine(edit: TextEdit): number {
  let { start, end } = edit.range
  if (edit.newText.endsWith('\n') && start.line == end.line && start.character == 0 && end.character == 0) {
    return start.line - 1
  }
  return start.line
}

export function lineCountChange(edit: TextEdit): number {
  let { newText } = edit
  let range = getWellformedRange(edit.range)
  let n = range.end.line - range.start.line
  return newText.split(/\r?\n/).length - n - 1
}

export function getWellformedRange(range: Range): Range {
  const start = range.start
  const end = range.end
  if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
    return { start: end, end: start }
  }
  return range
}

export function getWellformedEdit(textEdit: TextEdit) {
  const range = getWellformedRange(textEdit.range)
  if (range !== textEdit.range) {
    return { newText: textEdit.newText, range }
  }
  return textEdit
}

function mergeSort<T>(data: T[], compare: (a: T, b: T) => number): T[] {
  if (data.length <= 1) {
    // sorted
    return data
  }
  const p = (data.length / 2) | 0
  const left = data.slice(0, p)
  const right = data.slice(p)
  mergeSort(left, compare)
  mergeSort(right, compare)
  let leftIdx = 0
  let rightIdx = 0
  let i = 0
  while (leftIdx < left.length && rightIdx < right.length) {
    let ret = compare(left[leftIdx], right[rightIdx])
    if (ret <= 0) {
      // smaller_equal -> take left to preserve order
      data[i++] = left[leftIdx++]
    } else {
      // greater -> take right
      data[i++] = right[rightIdx++]
    }
  }
  while (leftIdx < left.length) {
    data[i++] = left[leftIdx++]
  }
  while (rightIdx < right.length) {
    data[i++] = right[rightIdx++]
  }
  return data
}

export function mergeSortEdits<T extends { range: Range }>(edits: T[]): T[] {
  return mergeSort(edits, (a, b) => {
    let diff = a.range.start.line - b.range.start.line
    if (diff === 0) {
      return a.range.start.character - b.range.start.character
    }
    return diff
  })
}

export function emptyTextEdit(edit: TextEdit): boolean {
  return emptyRange(edit.range) && edit.newText.length === 0
}

export function emptyWorkspaceEdit(edit: WorkspaceEdit): boolean {
  let { changes, documentChanges } = edit
  if (documentChanges && documentChanges.length) return false
  if (changes && Object.keys(changes).length) return false
  return true
}

export function getRangesFromEdit(uri: string, edit: WorkspaceEdit): Range[] | undefined {
  let { changes, documentChanges } = edit
  if (changes) {
    let edits = changes[uri]
    return edits ? edits.map(e => e.range) : undefined
  } else if (Array.isArray(documentChanges)) {
    for (let c of documentChanges) {
      if (TextDocumentEdit.is(c) && c.textDocument.uri == uri) {
        return c.edits.map(e => e.range)
      }
    }
  }
  return undefined
}

export function getConfirmAnnotations(changes: ReadonlyArray<DocumentChange>, changeAnnotations: { [id: string]: ChangeAnnotation }): ReadonlyArray<string> {
  let keys: string[] = []
  const add = (key: string | undefined) => {
    if (key && !keys.includes(key) && changeAnnotations[key]?.needsConfirmation) keys.push(key)
  }
  for (let change of changes) {
    if (TextDocumentEdit.is(change)) {
      change.edits.forEach(edit => {
        add(edit['annotationId'])
      })
    } else {
      add(change.annotationId)
    }
  }
  return keys
}

export function isDeniedEdit(edit: TextEdit | AnnotatedTextEdit | SnippetTextEdit, denied: string[]): boolean {
  if (AnnotatedTextEdit.is(edit) && denied.includes(edit.annotationId)) return true
  return false
}

/**
 * Create new changes with denied filtered
 */
export function createFilteredChanges(documentChanges: DocumentChange[], denied: string[]): DocumentChange[] {
  let changes: DocumentChange[] = []
  documentChanges.forEach(change => {
    if (TextDocumentEdit.is(change)) {
      let edits = change.edits.filter(edit => {
        return !isDeniedEdit(edit, denied)
      })
      if (edits.length > 0) {
        changes.push({ textDocument: change.textDocument, edits })
      }
    } else if (!denied.includes(change.annotationId)) {
      changes.push(change)
    }
  })
  return changes
}

export function getAnnotationKey(change: DocumentChange): string | undefined {
  let key: string
  if (TextDocumentEdit.is(change)) {
    if (AnnotatedTextEdit.is(change.edits[0])) {
      key = change.edits[0].annotationId
    }
  } else {
    key = change.annotationId
  }
  return key
}

export function toDocumentChanges(edit: WorkspaceEdit): DocumentChange[] {
  if (edit.documentChanges) return edit.documentChanges
  let changes: DocumentChange[] = []
  for (let [uri, edits] of Object.entries(toObject(edit.changes))) {
    changes.push({ textDocument: { uri, version: null }, edits })
  }
  return changes
}

/**
 * Filter unnecessary edits and fix edits.
 */
export function filterSortEdits(textDocument: LinesTextDocument, edits: TextEdit[]): TextEdit[] {
  let res: TextEdit[] = []
  let end = textDocument.end
  let checkEnd = end.line > 0 && end.character == 0
  let prevDelete: Position | undefined
  for (let i = 0; i < edits.length; i++) {
    let edit = edits[i]
    let { newText, range } = edit
    let max = (textDocument.lines[range.end.line] ?? '').length
    range = toValidRange(edit.range, max)
    if (prevDelete) {
      // merge possible delete, insert edits.
      if (samePosition(prevDelete, range.start) && emptyRange(range) && newText.length > 0) {
        let last = res[res.length - 1]
        last.newText = newText
        prevDelete = undefined
        continue
      }
      prevDelete = undefined
    }
    if (newText.includes('\r')) newText = newText.replace(/\r\n/g, '\n')
    let d = comparePosition(range.end, end)
    if (d > 0) range.end = { line: end.line, character: end.character }
    if (textDocument.getText(range) !== newText) {
      // Adjust textEdit to make it acceptable by nvim_buf_set_text
      if (d === 0 && checkEnd && !emptyRange(range) && newText.endsWith('\n')) {
        newText = newText.slice(0, -1)
        let text = textDocument.lines[end.line - 1]
        range.end = Position.create(end.line - 1, text.length)
      } else if (newText.length == 0) {
        prevDelete = range.start
      }
      res.push({ range, newText })
    }
  }
  return mergeSortEdits(res)
}

/**
 * Apply valid & sorted edits
 */
export function applyEdits(document: LinesTextDocument, edits: TextEdit[] | undefined): string[] | undefined {
  if (isFalsyOrEmpty(edits)) return undefined
  if (edits.length == 1) {
    let { start, end } = edits[0].range
    let { lines } = document
    let sl = lines[start.line] ?? ''
    let el = lines[end.line] ?? ''
    let content = sl.substring(0, start.character) + edits[0].newText + el.substring(end.character)
    if (end.line >= lines.length && document.eol) {
      if (content == '') {
        const result = [...lines.slice(0, start.line)]
        return result.length === 0 ? [''] : result
      }
      if (content.endsWith('\n')) content = content.slice(0, -1)
      return [...lines.slice(0, start.line), ...content.split('\n')]
    }
    return [...lines.slice(0, start.line), ...content.split('\n'), ...lines.slice(end.line + 1)]
  }
  let text = document.getText()
  let lastModifiedOffset = 0
  const spans = []
  for (const e of edits) {
    let startOffset = document.offsetAt(e.range.start)
    if (startOffset < lastModifiedOffset) {
      throw new Error('Overlapping edit')
    }
    else if (startOffset > lastModifiedOffset) {
      spans.push(text.substring(lastModifiedOffset, startOffset))
    }
    if (e.newText.length) {
      spans.push(e.newText)
    }
    lastModifiedOffset = document.offsetAt(e.range.end)
  }
  spans.push(text.substring(lastModifiedOffset))
  let result = spans.join('')
  if (result === text) return undefined
  return contentToLines(result, document.eol)
}

export function getRangeText(lines: ReadonlyArray<string>, range: Range): string {
  let result: string[] = []
  const { start, end } = range
  if (start.line === end.line) {
    let line = toText(lines[start.line])
    return line.slice(start.character, end.character)
  }
  for (let i = start.line; i <= end.line; i++) {
    let line = toText(lines[i])
    let text = line
    if (i === start.line) {
      text = line.slice(start.character)
    } else if (i === end.line) {
      text = line.slice(0, end.character)
    }
    result.push(text)
  }
  return result.join('\n')
}

export function validEdit(edit: TextEdit): boolean {
  let { range, newText } = edit
  if (!newText.endsWith('\n')) return false
  if (range.end.character !== 0) return false
  return true
}

export function toTextChanges(lines: ReadonlyArray<string>, edits: TextEdit[]): TextChangeItem[] {
  if (edits.length === 0) return []
  for (let edit of edits) {
    if (edit.range.end.line > lines.length) return []
    if (edit.range.end.line == lines.length) {
      // should only be insert at the end
      if (!validEdit(edit)) return []
      let line = lines.length - 1
      let character = lines[line].length
      if (emptyRange(edit.range)) {
        // convert to insert at the end of last line.
        edit.range = Range.create(line, character, line, character)
        edit.newText = '\n' + edit.newText.slice(0, -1)
      } else {
        // convert to replace to the end of last line.
        const start = edit.range.start
        edit.range = Range.create(start, Position.create(line, character))
        edit.newText = edit.newText.slice(0, -1)
      }
    }
  }
  return edits.map(o => {
    const oldText = getRangeText(lines, o.range)
    let edit = reduceTextEdit(o, oldText)
    let { start, end } = edit.range
    let sl = toText(lines[start.line])
    let sc = byteIndex(sl, start.character)
    let el = end.line == start.line ? sl : toText(lines[end.line])
    let ec = byteIndex(el, end.character)
    let { newText } = edit
    return [newText.length > 0 ? newText.split('\n') : [], start.line, sc, end.line, ec]
  })
}

export function getChangedPosition(start: Position, edit: TextEdit): { line: number; character: number } {
  let { range, newText } = edit
  if (comparePosition(range.end, start) <= 0) {
    let lines = newText.split('\n')
    let lineCount = lines.length - (range.end.line - range.start.line) - 1
    let character = start.character
    if (range.end.line == start.line) {
      let last = lines[lines.length - 1].length
      if (lines.length > 1) {
        character = last + character - range.end.character
      } else {
        character = range.start.character + last + character - range.end.character
      }
    }
    return { line: lineCount, character: character - start.character }
  }
  return { line: 0, character: 0 }
}

export function getPosition(start: Position, edit: TextEdit): Position {
  let { line, character } = start
  let { range, newText } = edit
  let { end } = range
  let lines = newText.split('\n')
  let lineCount = lines.length - (end.line - range.start.line) - 1
  let c = range.end.line - start.line
  if (c > 0) return { line, character }
  if (c < 0) return { line: line + lineCount, character }
  if (lines.length > 1) {
    let last = lines[lines.length - 1].length
    return { line: line + lineCount, character: last + character - end.character }
  }
  let d = range.start.character - range.end.character
  return { line: line + lineCount, character: d + newText.length + character }
}

/**
 * Get new position from sorted edits
 */
export function getPositionFromEdits(start: Position, edits: TextEdit[]): Position {
  let position = Position.create(start.line, start.character)
  let before = false
  for (let i = edits.length - 1; i >= 0; i--) {
    let edit = edits[i]
    if (before) {
      position.line += lineCountChange(edit)
      continue
    }
    let d = comparePosition(edit.range.end, position)
    if (d > 0) continue
    if (edit.range.end.line == position.line) {
      position = getPosition(position, edit)
    } else {
      before = true
      position.line += lineCountChange(edit)
    }
  }
  return position
}

export function getChangedLineCount(start: Position, edits: TextEdit[]): number {
  let total = 0
  for (let edit of edits) {
    let r = getWellformedRange(edit.range)
    if (comparePosition(r.end, start) <= 0) {
      total += lineCountChange(edit)
    }
  }
  return total
}

/**
 * Merge sorted edits to single textedit
 */
export function mergeTextEdits(edits: TextEdit[], oldLines: ReadonlyArray<string>, newLines: ReadonlyArray<string>): TextEdit {
  let start = edits[0].range.start
  let end = edits[edits.length - 1].range.end
  let lr = oldLines.length - end.line
  let cr = (oldLines[end.line] ?? '').length - end.character
  let line = newLines.length - lr
  let character = (newLines[line] ?? '').length - cr
  let newText = getRangeText(newLines, Range.create(start, Position.create(line, character)))
  return TextEdit.replace(Range.create(start, end), newText)
}

/*
 * Avoid change unnecessary range of text.
 */
export function reduceTextEdit(edit: TextEdit, oldText: string): TextEdit {
  if (oldText.length === 0) return edit
  let { range, newText } = edit
  let ol = oldText.length
  let nl = newText.length
  if (ol === 0 || nl === 0) return edit
  let { start, end } = range
  let bo = 0
  for (let i = 1; i <= Math.min(nl, ol); i++) {
    if (newText[i - 1] === oldText[i - 1]) {
      bo = i
    } else {
      break
    }
  }
  let eo = 0
  let t = Math.min(nl - bo, ol - bo)
  if (t > 0) {
    for (let i = 1; i <= t; i++) {
      if (newText[nl - i] === oldText[ol - i]) {
        eo = i
      } else {
        break
      }
    }
  }
  let text = eo == 0 ? newText.slice(bo) : newText.slice(bo, -eo)
  if (bo > 0) start = getEnd(start, newText.slice(0, bo))
  if (eo > 0) end = getEnd(range.start, oldText.slice(0, -eo))
  return TextEdit.replace(Range.create(start, end), text)
}

export function getRevertEdit(oldLines: ReadonlyArray<string>, newLines: ReadonlyArray<string>, startLine: number): TextEdit | undefined {
  if (equals(oldLines, newLines)) return undefined
  let changed = diffLines(oldLines, newLines, startLine)
  let original = oldLines.slice(changed.start, changed.end)
  let range = Range.create(changed.start, 0, changed.start + changed.replacement.length, 0)
  return TextEdit.replace(range, original.join('\n') + (original.length > 0 ? '\n' : ''))
}
