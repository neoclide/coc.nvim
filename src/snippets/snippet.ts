'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { LinesTextDocument } from '../model/textdocument'
import { TabStopInfo } from '../types'
import { defaultValue } from '../util'
import { adjacentPosition, emptyRange, getEnd, positionInRange, rangeInRange, samePosition } from '../util/position'
import { CancellationToken } from '../util/protocol'
import { getChangedPosition } from '../util/textedit'
import { executePythonCode, getSnippetPythonCode, hasPython, preparePythonCodes } from './eval'
import { Choice, Marker, Placeholder, SnippetParser, Text, TextmateSnippet, VariableResolver } from "./parser"
import { getAction, UltiSnippetContext, UltiSnipsAction, UltiSnipsOption } from './util'

export interface CocSnippetPlaceholder {
  index: number
  marker: Placeholder
  value: string
  primary: boolean
  transform: boolean
  // range in current buffer
  range: Range
  // snippet text before
  before: string
  // snippet text after
  after: string
  nestCount: number
}

export interface CocSnippetInfo {
  marker: TextmateSnippet
  range: Range
}

export interface CursorDelta {
  // the line change cursor should move
  line: number
  // the character count cursor should move
  character: number
}

// The python global code for different snippets. Note: variable `t` not included
// including `context` `match`
// TODO save on insertNest and switch on snippet change
const snippetsPythonGlobalCodes: WeakMap<TextmateSnippet, string[]> = new WeakMap()
const snippetsPythonContexts: WeakMap<TextmateSnippet, UltiSnippetContext> = new WeakMap()

export class CocSnippet {
  // placeholders and snippets from top to bottom
  private _markerSeuqence: (Placeholder | TextmateSnippet)[] = []
  private _placeholders: CocSnippetPlaceholder[] = []
  // from upper to lower
  private _snippets: CocSnippetInfo[] = []
  private _doc: LinesTextDocument
  private _tmSnippet: TextmateSnippet

  constructor(
    private snippetString: string,
    private position: Position,
    private nvim: Neovim,
    private resolver?: VariableResolver,
  ) {
  }

  public get tmSnippet(): TextmateSnippet {
    return this._tmSnippet
  }

  public getUltiSnipAction(marker: Marker | undefined, action: UltiSnipsAction): string | undefined {
    if (!marker) return undefined
    let snip = marker instanceof TextmateSnippet ? marker : marker.snippet
    let context = snippetsPythonContexts.get(snip)
    return getAction(context, action)
  }

  public getUltiSnipOption(marker: Marker, key: UltiSnipsOption): boolean | undefined {
    let snip = marker instanceof TextmateSnippet ? marker : marker.snippet
    let context = snippetsPythonContexts.get(snip)
    if (!context) return undefined
    return context[key]
  }

  public async init(ultisnip?: UltiSnippetContext): Promise<void> {
    const parser = new SnippetParser(!!ultisnip)
    const snippet = parser.parse(this.snippetString, true)
    this._tmSnippet = snippet
    await this.resolve(snippet, ultisnip)
    this.synchronize()
  }

  private async resolve(snippet: TextmateSnippet, ultisnip?: UltiSnippetContext): Promise<void> {
    let { resolver, nvim } = this
    if (resolver) {
      await snippet.resolveVariables(resolver)
    }
    if (ultisnip) {
      let pyCodes: string[] = []
      snippetsPythonContexts.set(snippet, ultisnip)
      if (ultisnip.noPython !== true && (snippet.hasCodeBlock || hasPython(ultisnip))) {
        snippetsPythonGlobalCodes.set(snippet, getSnippetPythonCode(ultisnip))
        pyCodes = snippet.hasPythonBlock ? preparePythonCodes(ultisnip) : []
      }
      await snippet.evalCodeBlocks(nvim, pyCodes)
    }
  }

  /**
   * Same index and same in same snippet only
   */
  public getRanges(placeholder: CocSnippetPlaceholder): Range[] {
    if (placeholder.value.length == 0) return []
    let tmSnippet = placeholder.marker.parentSnippet
    let placeholders = this._placeholders.filter(o => o.index == placeholder.index && o.marker.parentSnippet === tmSnippet)
    return placeholders.map(o => o.range).filter(r => !emptyRange(r))
  }

  /**
   * The change must happens with same marker parents, return the changed marker
   */
  public replaceWithMarker(range: Range, marker: Marker, current?: Placeholder): Marker | undefined {
    // the range should already inside this.range
    const isInsert = emptyRange(range)
    if (isInsert && marker instanceof Text && marker.value == '') return
    let parentMarker: Placeholder | TextmateSnippet
    let parentRange: Range
    // search placeholders & snippets from bottom to up
    const { _snippets, _placeholders } = this
    const seq = this._markerSeuqence.filter(o => o !== current)
    if (current) seq.push(current)
    const list = seq.map(m => {
      return m instanceof TextmateSnippet ? _snippets.find(o => o.marker === m) : _placeholders.find(o => o.marker === m)
    })
    for (let index = list.length - 1; index >= 0; index--) {
      const o = list[index]
      if (rangeInRange(range, o.range)) {
        // not current placeholder and insert at beginning or end, check parents
        if (isInsert
          && o instanceof Placeholder
          && o.choice
          && o !== current
          && adjacentPosition(range.start, o.range)
        ) {
          continue
        }
        parentMarker = o.marker
        parentRange = o.range
        break
      }
    }
    // Could be invalid range
    if (!parentMarker) return undefined
    // search children need to be replaced
    const children = parentMarker.children
    let pos = parentRange.start
    let startIdx = 0
    let deleteCount = 0
    const { start, end } = range
    let startMarker: Marker | undefined
    let endMarker: Marker | undefined
    let preText = ''
    let afterText = ''
    let len = children.length
    for (let i = 0; i < len; i++) {
      let child = children[i]
      let value = child.toString()
      let s = Position.create(pos.line, pos.character)
      let e = getEnd(s, value)
      let r = Range.create(s, e)
      // Not include position at the end of marker
      if (startMarker == null && positionInRange(start, r) === 0 && !samePosition(start, e)) {
        startMarker = child
        startIdx = i
        preText = getTextBefore(Range.create(s, e), value, start)
        // avoid delete when insert at the beginning
        if (isInsert && samePosition(end, s)) {
          endMarker = child
          break
        }
      }
      if (startMarker != null) {
        let val = positionInRange(end, r)
        if (val === 0) {
          endMarker = child
          afterText = getTextAfter(Range.create(s, e), value, end)
        }
        deleteCount += 1
      } else if (i == len - 1 && samePosition(start, e)) {
        // insert at the end
        startIdx = len
      }
      if (endMarker != null) break
      pos = e
    }
    if (marker instanceof Text) {
      // try merge text before and after
      let m = children[startIdx - 1]
      if (m instanceof Text || m instanceof Choice) {
        startIdx -= 1
        deleteCount += 1
        preText = m.toString() + preText
      }
      m = children[startIdx + deleteCount]
      if (m instanceof Text || m instanceof Choice) {
        deleteCount += 1
        afterText = afterText + m.toString()
      }
      let newText = new Text(preText + marker.value + afterText)
      // Consider delete text completely
      if (newText.value.length === 0) newText = undefined
      parentMarker.children.splice(startIdx, deleteCount, newText)
      if (newText) newText.parent = parentMarker
    } else {
      let markers: Marker[] = []
      if (preText) {
        let m = children[startIdx - 1]
        if (m instanceof Text) {
          startIdx -= 1
          deleteCount += 1
          preText = m.value + preText
        }
        markers.push(new Text(preText))
      }
      if (parentMarker instanceof TextmateSnippet) {
        // create a new Placeholder to make it selectable by jump
        let p = new Placeholder((current ? current.index : 0) + Math.random())
        p.appendChild(marker)
        marker.parent = p
        markers.push(p)
      } else {
        markers.push(marker)
      }
      if (afterText) {
        // try merge Text after
        let m = children[startIdx + deleteCount]
        if (m instanceof Text) {
          deleteCount += 1
          afterText = afterText + m.value
        }
        markers.push(new Text(afterText))
      }
      children.splice(startIdx, deleteCount, ...markers)
      markers.forEach(m => m.parent = parentMarker)
    }
    return parentMarker
  }

  /**
   * Replace range with text, return new Cursor position when cursor provided
   *
   * Get new Cursor position for synchronize update only.
   * The cursor position should already adjusted before call this function.
   */
  public async replaceWithText(range: Range, text: string, current?: Placeholder, cursor?: Position): Promise<Position | undefined> {
    let marker = this.replaceWithMarker(range, new Text(text), current)
    // No need further action when only affect the top snippet.
    if (!marker || marker === this._tmSnippet) return
    // Try keep relative position with marker, since no more change for marker.
    let sp = this.getMarkerPosition(marker)
    let keeyCharacter = cursor && sp.line === cursor.line
    await this.onMarkerUpdate(marker)
    let ep = this.getMarkerPosition(marker)
    if (cursor && sp && ep) {
      return {
        line: cursor.line + ep.line - sp.line,
        character: cursor.character + (keeyCharacter ? 0 : ep.character - sp.character)
      }
    }
  }

  public async replaceWithSnippet(range: Range, text: string, current?: Placeholder, ultisnip?: UltiSnippetContext): Promise<TextmateSnippet> {
    let snippet = new SnippetParser(!!ultisnip).parse(text, true)
    snippet.removeUnnecessaryFinal()
    // no need to move cursor, there should be placeholder selection afterwards.
    let changed = this.replaceWithMarker(range, snippet, current)
    await this.resolve(snippet, ultisnip)
    await this.onMarkerUpdate(changed)
    return snippet
  }

  /**
   * Get placeholder or snippet start position in current document
   */
  public getMarkerPosition(marker: Marker): Position | undefined {
    if (marker instanceof Placeholder) {
      let p = this._placeholders.find(o => o.marker === marker)
      return p ? p.range.start : undefined
    }
    let o = this._snippets.find(o => o.marker === marker)
    return o ? o.range.start : undefined
  }

  private async onMarkerUpdate(marker: Marker): Promise<void> {
    let snippet = marker instanceof TextmateSnippet ? marker : marker.snippet
    let switched = false
    while (marker != null) {
      if (marker instanceof Placeholder) {
        let snip = marker.snippet
        if (!snip) break
        let succeed = await this.executeGlobalCode(snip)
        if (succeed && snip !== snippet) switched = true
        await snip.update(this.nvim, marker)
        marker = snip.parent
      } else {
        marker = marker.parent
      }
    }
    if (switched) await this.executeGlobalCode(snippet)
    this.synchronize()
  }

  public async executeGlobalCode(snip: TextmateSnippet | undefined): Promise<boolean> {
    let codes = snippetsPythonGlobalCodes.get(snip)
    if (codes) {
      await executePythonCode(this.nvim, codes, true)
      return true
    }
    return false
  }

  // TODO remove this
  public getSortedPlaceholders(curr?: CocSnippetPlaceholder | undefined): CocSnippetPlaceholder[] {
    let finalPlaceholder: CocSnippetPlaceholder
    const arr: CocSnippetPlaceholder[] = []
    this._placeholders.forEach(p => {
      if (p === curr || p.transform) return
      if (p.index === 0) {
        finalPlaceholder = p
        return
      }
      arr.push(p)
    })
    arr.sort(comparePlaceholder)
    return [curr, ...arr, finalPlaceholder].filter(o => o != null)
  }

  private usePython(snip: TextmateSnippet): boolean {
    return snip.hasCodeBlock || hasPython(snippetsPythonContexts.get(snip))
  }

  public get hasPython(): boolean {
    for (const info of this._snippets) {
      let snip = info.marker
      if (this.usePython(snip)) return true
    }
    return false
  }

  public resetStartPosition(pos: Position): void {
    this.position = pos
    this.synchronize()
  }

  public get start(): Position {
    return Position.create(this.position.line, this.position.character)
  }

  public get range(): Range {
    let doc = this._doc
    let { character, line } = this.position
    let { lineCount } = doc
    let el = line + lineCount - 1
    let ec = lineCount == 1 ? character + doc.lines[0].length : doc.lines[lineCount - 1].length
    return Range.create(this.position, Position.create(el, ec))
  }

  public get text(): string {
    return this._doc.getText()
  }

  public getPlaceholderByMarker(marker: Marker): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.marker === marker)
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | undefined {
    let marker = this.tmSnippet.first
    return this.getPlaceholderByMarker(marker)
  }

  public getPlaceholderByIndex(index: number): CocSnippetPlaceholder {
    let filtered = this._placeholders.filter(o => o.index == index && !o.transform)
    let find = filtered.find(o => o.primary)
    return defaultValue(find, filtered[0])
  }

  // TODO use marker
  public getPrevPlaceholder(index: number): CocSnippetPlaceholder | undefined {
    if (index <= 1) return undefined
    let placeholders = this._placeholders.filter(o => o.index < index && o.index != 0 && !o.transform)
    let find: CocSnippetPlaceholder
    while (index > 1) {
      index = index - 1
      let arr = placeholders.filter(o => o.index == index)
      if (arr.length) {
        find = defaultValue(arr.find(o => o.primary), arr[0])
        break
      }
    }
    return find
  }

  // TODO use marker
  public getNextPlaceholder(index: number): CocSnippetPlaceholder | undefined {
    let placeholders = this._placeholders.filter(o => !o.transform)
    let find: CocSnippetPlaceholder
    let indexes = placeholders.map(o => o.index)
    let max = Math.max.apply(null, indexes)
    for (let i = index + 1; i <= max + 1; i++) {
      let idx = i == max + 1 ? 0 : i
      let arr = placeholders.filter(o => o.index == idx)
      if (arr.length) {
        find = arr.find(o => o.primary) || arr[0]
        break
      }
    }
    return find
  }

  // TODO remove this
  public getPlaceholderByRange(range: Range): CocSnippetPlaceholder {
    return this._placeholders.find(o => rangeInRange(range, o.range))
  }

  public async insertSnippet(placeholder: CocSnippetPlaceholder, snippet: string, parts: [string, string], ultisnip?: UltiSnippetContext): Promise<Placeholder> {
    let select = this._tmSnippet.insertSnippet(snippet, placeholder.marker, parts, ultisnip)
    // TODO use insertNestedSnippet need synchronize upper snippet.
    await this.resolve(this._tmSnippet, ultisnip)
    this.synchronize()
    return select
  }

  /**
   * Check newText for placeholder.
   * TODO remove this
   */
  public getNewText(placeholder: CocSnippetPlaceholder, inserted: string): string | undefined {
    let { before, after } = placeholder
    if (!inserted.startsWith(before)) return undefined
    if (inserted.length < before.length + after.length) return undefined
    if (!inserted.endsWith(after)) return undefined
    if (!after.length) return inserted.slice(before.length)
    return inserted.slice(before.length, - after.length)
  }

  // TODO remove this
  public async updatePlaceholder(placeholder: CocSnippetPlaceholder, cursor: Position, newText: string, token: CancellationToken): Promise<{ text: string; delta: Position } | undefined> {
    let start = this.position
    let { marker, before } = placeholder
    let cloned = this._tmSnippet.clone()
    token.onCancellationRequested(() => {
      this._tmSnippet = cloned
      this.synchronize()
    })
    // range before placeholder
    let r = Range.create(start, getEnd(start, before))
    // update the snippet
    marker.setOnlyChild(new Text(newText))
    await this._tmSnippet.update(this.nvim, marker)

    if (token.isCancellationRequested) return undefined
    this.synchronize()
    let after = this.getTextBefore(marker, before)
    return { text: this.text, delta: getChangedPosition(cursor, TextEdit.replace(r, after)) }
  }

  // TODO remove this
  public getTextBefore(marker: Placeholder, defaultValue: string): string {
    let placeholder = this._placeholders.find(o => o.marker == marker)
    if (placeholder) return placeholder.before
    return defaultValue
  }

  public getTabStopInfo(): TabStopInfo[] {
    let res: TabStopInfo[] = []
    this._placeholders.forEach(p => {
      if (p.marker instanceof Placeholder && (p.primary || p.index === 0)) {
        res.push({
          index: p.index,
          range: [p.range.start.line, p.range.start.character, p.range.end.line, p.range.end.character],
          text: p.value
        })
      }
    })
    return res
  }

  /**
   * Should be used after snippet resolved.
   */
  private synchronize(): void {
    const snippet = this._tmSnippet
    const snippetStr = snippet.toString()
    const document = new LinesTextDocument('/', '', 0, snippetStr.split(/\n/), 0, false)
    const placeholders: CocSnippetPlaceholder[] = []
    const snippets: CocSnippetInfo[] = []
    const markerSeuqence = []
    const { start } = this
    snippets.push({ range: Range.create(start, getEnd(start, snippetStr)), marker: snippet })
    markerSeuqence.push(snippet)
    // all placeholders, including nested placeholder from snippet
    let offset = 0
    snippet.walk(marker => {
      if (marker instanceof Placeholder) {
        markerSeuqence.push(marker)
        const position = document.positionAt(offset)
        const value = marker.toString()
        const end = getEnd(position, value)
        placeholders.push({
          index: marker.index,
          value,
          marker,
          range: getNewRange(start, position, value),
          // TODO only need texts of specific line
          before: document.getText(Range.create(Position.create(0, 0), position)),
          after: document.getText(Range.create(end, Position.create(document.lineCount, 0))),
          // TODO not needed those
          transform: !!marker.transform,
          nestCount: marker.nestedPlaceholderCount,
          primary: marker.primary === true
        })
      } else if (marker instanceof TextmateSnippet) {
        markerSeuqence.push(marker)
        const position = document.positionAt(offset)
        const value = marker.toString()
        snippets.push({
          range: getNewRange(start, position, value),
          marker
        })
      }
      offset += marker.len()
      return true
    }, false)
    this._snippets = snippets
    this._doc = document
    this._placeholders = placeholders
    this._markerSeuqence = markerSeuqence
  }
}

/*
 * Avoid change unnecessary range of text.
 */
export function reduceTextEdit(edit: TextEdit, oldText: string): TextEdit {
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

/*
 * Check if cursor inside
 * TODO remove this
 */
export function checkCursor(start: Position, cursor: Position, newText: string): boolean {
  let r = Range.create(start, getEnd(start, newText))
  return positionInRange(cursor, r) == 0
}

/*
 * Check if textDocument have same text before position.
 */
export function checkContentBefore(position: Position, oldTextDocument: LinesTextDocument, textDocument: LinesTextDocument): boolean {
  let lines = textDocument.lines
  if (lines.length < position.line) return false
  let checked = true
  for (let i = position.line; i >= 0; i--) {
    let newLine = textDocument.lines[i] ?? ''
    if (i === position.line) {
      let before = oldTextDocument.lines[i].slice(0, position.character)
      if (!newLine.startsWith(before)) {
        checked = false
        break
      }
    } else if (newLine !== oldTextDocument.lines[i]) {
      checked = false
      break
    }
  }
  return checked
}

/**
 * Get new end position by old end position and new TextDocument
 */
export function getEndPosition(position: Position, oldTextDocument: LinesTextDocument, textDocument: LinesTextDocument): Position | undefined {
  let total = oldTextDocument.lines.length
  if (textDocument.lines.length < total - position.line) return undefined
  let end: Position
  let cl = textDocument.lines.length - total
  for (let i = position.line; i < total; i++) {
    let newLine = textDocument.lines[i + cl]
    if (i == position.line) {
      let text = oldTextDocument.lines[i].slice(position.character)
      if (text.length && !newLine.endsWith(text)) break
      end = Position.create(i + cl, newLine.length - text.length)
    } else if (newLine !== oldTextDocument.lines[i]) {
      end = undefined
      break
    }
  }
  return end
}

// TODO remove this
export function equalToPosition(position: Position, oldTextDocument: LinesTextDocument, textDocument: LinesTextDocument): boolean {
  let endLine = position.line
  for (let i = 0; i < endLine; i++) {
    if (oldTextDocument.lines[i] !== textDocument.lines[i]) return false
  }
  if (oldTextDocument.lines[endLine].slice(0, position.character) === textDocument.lines[endLine].slice(0, position.character)) {
    return true
  }
  return false
}

/*
 * TODO remove this
 */
export function getParts(text: string, range: Range, r: Range): [string, string] {
  let before: string[] = []
  let after: string[] = []
  let lines = text.split('\n')
  let d = r.start.line - range.start.line
  for (let i = 0; i <= d; i++) {
    let s = defaultValue(lines[i], '')
    if (i == d) {
      before.push(i == 0 ? s.substring(0, r.start.character - range.start.character) : s.substring(0, r.start.character))
    } else {
      before.push(s)
    }
  }
  d = range.end.line - r.end.line
  for (let i = 0; i <= d; i++) {
    let s = lines[r.end.line - range.start.line + i] ?? ''
    if (i == 0) {
      if (d == 0) {
        after.push(range.end.character == r.end.character ? '' : s.slice(r.end.character - range.end.character))
      } else {
        after.push(s.substring(r.end.character))
      }
    } else {
      after.push(s)
    }
  }
  return [before.join('\n'), after.join('\n')]
}

// TODO remove this
export function comparePlaceholder(a: { primary: boolean, index: number, nestCount: number }, b: { primary: boolean, index: number, nestCount: number }): number {
  // check inner placeholder first
  if (a.nestCount !== b.nestCount) return a.nestCount - b.nestCount
  if (a.primary !== b.primary) return a.primary ? -1 : 1
  return a.index - b.index
}

/**
 * TODO test
 */
export function getNextPlaceholder(marker: Placeholder, forward: boolean): Placeholder | undefined {
  let idx = marker.index
  if (idx <= 0) return undefined
  let arr: Placeholder[] = []
  let min_index: number
  let max_index: number
  const snippet = marker.snippet
  snippet.walk(m => {
    if (m instanceof Placeholder && (m.primary || m.isFinalTabstop)) {
      if (
        (forward && (m.index > idx || m.isFinalTabstop)) ||
        (!forward && (m.index < idx && !m.isFinalTabstop))
      ) {
        arr.push(m)
        if (!m.isFinalTabstop) {
          min_index = min_index === undefined ? m.index : Math.min(min_index, m.index)
        }
        max_index = max_index === undefined ? m.index : Math.max(max_index, m.index)
      }
    }
    return true
  }, true)
  if (arr.length > 0) {
    if (forward) return min_index === undefined ? arr[0] : arr.find(o => o.index === min_index)
    return arr.find(o => o.index === max_index)
  }
  if (snippet.parent instanceof Placeholder) {
    return getNextPlaceholder(snippet.parent, forward)
  }
  return undefined
}

/**
 * Get range from base position and position, text
 */
export function getNewRange(base: Position, pos: Position, value: string): Range {
  const { line, character } = base
  const start: Position = {
    line: line + pos.line,
    character: pos.line == 0 ? character + pos.character : pos.character
  }
  return Range.create(start, getEnd(start, value))
}

export function getTextBefore(range: Range, text: string, pos: Position): string {
  let newLines = []
  let { line, character } = range.start
  let n = pos.line - line
  const lines = text.split('\n')
  for (let i = 0; i <= n; i++) {
    let line = lines[i]
    if (i == n) {
      newLines.push(line.slice(0, i == 0 ? pos.character - character : pos.character))
    } else {
      newLines.push(line)
    }
  }
  return newLines.join('\n')
}

export function getTextAfter(range: Range, text: string, pos: Position): string {
  let newLines = []
  let { line, character } = range.end
  let n = line - pos.line
  const lines = text.split('\n')
  let len = lines.length
  for (let i = 0; i <= n; i++) {
    let idx = len - i - 1
    let line = lines[idx]
    if (i == n) {
      newLines.unshift(line.slice(idx == 0 ? pos.character - character : pos.character))
    } else {
      newLines.unshift(line)
    }
  }
  return newLines.join('\n')
}
