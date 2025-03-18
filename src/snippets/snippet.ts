'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { LinesTextDocument } from '../model/textdocument'
import { TabStopInfo } from '../types'
import { defaultValue } from '../util'
import { adjacentPosition, comparePosition, emptyRange, getEnd, positionInRange, rangeInRange, samePosition } from '../util/position'
import { CancellationToken } from '../util/protocol'
import { executePythonCode, getSnippetPythonCode, hasPython, preparePythonCodes } from './eval'
import { Marker, mergeTexts, Placeholder, SnippetParser, Text, TextmateSnippet, VariableResolver } from "./parser"
import { getAction, UltiSnippetContext, UltiSnipsAction, UltiSnipsOption } from './util'

export interface ParentInfo {
  marker: TextmateSnippet | Placeholder
  range: Range
}

export interface CocSnippetPlaceholder {
  index: number
  marker: Placeholder
  value: string
  primary: boolean
  // range in current buffer
  range: Range
}

export interface CocSnippetInfo {
  marker: TextmateSnippet
  value: string
  range: Range
}

export interface ChangedInfo {
  // The changed marker
  marker: Marker
  // snippet text with only changed marker changed
  snippetText: string
  cursor?: Position
}

export interface CursorDelta {
  // the line change cursor should move
  line: number
  // the character count cursor should move
  character: number
}

// The python global code for different snippets. Note: variable `t` not included
// including `context` `match`
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

  public deactivateSnippet(snip: TextmateSnippet): void {
    snippetsPythonGlobalCodes.delete(snip)
    snippetsPythonContexts.delete(snip)
    let marker = snip.parent
    if (marker) {
      let text = new Text(snip.toString())
      marker.replaceChild(snip, text)
      this.synchronize()
    }
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
      this.nvim.call('coc#compat#del_var', ['coc_selected_text'], true)
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

  public getPlaceholderOnJump(current: Placeholder, forward: boolean): CocSnippetPlaceholder | undefined {
    if (!current) return undefined
    const p = getNextPlaceholder(current, forward)
    return p ? this.getPlaceholderByMarker(p) : undefined
  }

  /**
   * Same index and same in same snippet only
   */
  public getRanges(placeholder: CocSnippetPlaceholder): Range[] {
    if (placeholder.value.length == 0) return []
    let tmSnippet = placeholder.marker.snippet
    let placeholders = this._placeholders.filter(o => o.index == placeholder.index && o.marker.snippet === tmSnippet)
    return placeholders.map(o => o.range).filter(r => !emptyRange(r))
  }

  public findParent(range: Range, current?: Placeholder): ParentInfo | undefined {
    const isInsert = emptyRange(range)
    let marker: TextmateSnippet | Placeholder
    let markerRange: Range
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
        marker = o.marker
        markerRange = o.range
        break
      }
    }
    return marker === undefined ? undefined : { marker, range: markerRange }
  }

  /**
   * The change must happens with same marker parents, return the changed marker
   */
  public replaceWithMarker(range: Range, marker: Marker, current?: Placeholder): Marker | undefined {
    // the range should already inside this.range
    const isInsert = emptyRange(range)
    if (isInsert && marker instanceof Text && marker.value == '') return
    const p = this.findParent(range, current)
    if (!p) return undefined
    let parentMarker = p.marker
    let parentRange = p.range
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
      let newText = new Text(preText + marker.value + afterText)
      // Placeholder have to contain empty Text
      parentMarker.children.splice(startIdx, deleteCount, newText)
      newText.parent = parentMarker
      mergeTexts(parentMarker, 0)
    } else {
      let markers: Marker[] = []
      if (preText) markers.push(new Text(preText))
      if (parentMarker instanceof TextmateSnippet) {
        // create a new Placeholder to make it selectable by jump
        let p = new Placeholder((current ? current.index : 0) + Math.random())
        p.appendChild(marker)
        p.primary = true
        marker.parent = p
        markers.push(p)
      } else {
        markers.push(marker)
      }
      if (afterText) markers.push(new Text(afterText))
      children.splice(startIdx, deleteCount, ...markers)
      markers.forEach(m => m.parent = parentMarker)
      if (preText.length > 0 || afterText.length > 0) {
        mergeTexts(parentMarker, 0)
      }
    }
    return parentMarker
  }

  /**
   * Replace range with text, return new Cursor position when cursor provided
   *
   * Get new Cursor position for synchronize update only.
   * The cursor position should already adjusted before call this function.
   */
  public async replaceWithText(range: Range, text: string, token: CancellationToken, current?: Placeholder, cursor?: Position): Promise<ChangedInfo | undefined> {
    let marker = this.replaceWithMarker(range, new Text(text), current)
    let snippetText = this._tmSnippet.toString()
    if (!marker) return
    // No need further action when only affect the top snippet.
    if (marker === this._tmSnippet) {
      this.synchronize()
      return { snippetText, marker }
    }
    // Try keep relative position with marker, since no more change for marker.
    let sp = this.getMarkerPosition(marker)
    let keepCharacter = cursor && sp.line === cursor.line
    let cloned = this._tmSnippet.clone()
    await this.onMarkerUpdate(marker)
    if (token.isCancellationRequested) {
      this._tmSnippet = cloned
      this.synchronize()
      return
    }
    let ep = this.getMarkerPosition(marker)
    let position: Position
    if (cursor && sp && ep) {
      position = {
        line: cursor.line + ep.line - sp.line,
        character: cursor.character + (keepCharacter ? 0 : ep.character - sp.character)
      }
    }
    return { snippetText, marker, cursor: position }
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

  public get hasBeginningPlaceholder(): boolean {
    let { position } = this
    return this._placeholders.find(o => comparePosition(o.range.start, position) === 0) != null
  }

  public get hasEndPlaceholder(): boolean {
    let position = this._snippets[0].range.end
    return this._placeholders.find(o => comparePosition(o.range.end, position) === 0) != null
  }

  public lineAt(line: number): string | undefined {
    return this._doc.lines[line - this.start.line]
  }

  public getPlaceholderByMarker(marker: Marker): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.marker === marker)
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | undefined {
    let marker = this.tmSnippet.first
    return this.getPlaceholderByMarker(marker)
  }

  public getPlaceholderByIndex(index: number): CocSnippetPlaceholder {
    let filtered = this._placeholders.filter(o => o.index == index && !o.marker.transform)
    let find = filtered.find(o => o.primary)
    return defaultValue(find, filtered[0])
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
    snippets.push({ range: Range.create(start, getEnd(start, snippetStr)), marker: snippet, value: snippetStr })
    markerSeuqence.push(snippet)
    // all placeholders, including nested placeholder from snippet
    let offset = 0
    snippet.walk(marker => {
      if (marker instanceof Placeholder) {
        markerSeuqence.push(marker)
        const position = document.positionAt(offset)
        const value = marker.toString()
        placeholders.push({
          index: marker.index,
          value,
          marker,
          range: getNewRange(start, position, value),
          primary: marker.primary === true
        })
      } else if (marker instanceof TextmateSnippet) {
        markerSeuqence.push(marker)
        const position = document.positionAt(offset)
        const value = marker.toString()
        snippets.push({
          range: getNewRange(start, position, value),
          marker,
          value
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

/**
 * Next or previous placeholder TODO test
 */
export function getNextPlaceholder(marker: Placeholder, forward: boolean): Placeholder | undefined {
  let { snippet } = marker
  let idx = marker.index
  if (idx <= 0 || !snippet) return undefined
  let arr: Placeholder[] = []
  let min_index: number
  let max_index: number
  snippet.walk(m => {
    if (m instanceof Placeholder && !m.transform) {
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
    arr.sort((a, b) => {
      if (b.primary && !a.primary) return 1
      if (a.primary && !b.primary) return -1
      return 0
    })
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
  let n = range.end.line - pos.line
  const lines = text.split('\n')
  let len = lines.length
  for (let i = 0; i <= n; i++) {
    let idx = len - i - 1
    let line = lines[idx]
    if (i == n) {
      let sc = range.start.character
      let from = idx == 0 ? pos.character - sc : pos.character
      newLines.unshift(line.slice(from))
    } else {
      newLines.unshift(line)
    }
  }
  return newLines.join('\n')
}
