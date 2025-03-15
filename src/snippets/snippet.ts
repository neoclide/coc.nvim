'use strict'
import { Neovim } from '@chemzqm/neovim'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { LinesTextDocument } from '../model/textdocument'
import { TabStopInfo } from '../types'
import { defaultValue } from '../util'
import { emptyRange, getEnd, positionInRange, rangeInRange } from '../util/position'
import { CancellationToken } from '../util/protocol'
import { getChangedPosition } from '../util/textedit'
import { getSnippetPythonCode, hasPython, prepareMatchCode, preparePythonCodes } from './eval'
import { SnippetFormatOptions } from './util'
import { UltiSnippetContext } from './util'
import * as Snippets from "./parser"
import { VariableResolver } from './parser'

export interface CocSnippetPlaceholder {
  index: number | undefined
  marker: Snippets.Placeholder
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

// The python global code for different snippets. Note: variable `t` not included
// including `context` `match`
// TODO save on insertNest and switch on snippet change
const snippetsPythonGlobalCodes: WeakMap<Snippets.TextmateSnippet, string[]> = new WeakMap()

export class CocSnippet {
  private _placeholders: CocSnippetPlaceholder[]
  private _text: string | undefined
  private _hasPython = false
  private _tmSnippet: Snippets.TextmateSnippet

  constructor(
    private snippetString: string,
    private position: Position,
    private nvim: Neovim,
    private resolver?: VariableResolver,
  ) {
  }

  public get tmSnippet(): Snippets.TextmateSnippet {
    return this._tmSnippet
  }

  public async init(ultisnip?: UltiSnippetContext): Promise<void> {
    const matchCode = ultisnip ? prepareMatchCode(ultisnip) : undefined
    const parser = new Snippets.SnippetParser(!!ultisnip, matchCode)
    const snippet = parser.parse(this.snippetString, true)
    this._tmSnippet = snippet
    if (ultisnip) snippetsPythonGlobalCodes.set(snippet, getSnippetPythonCode(ultisnip))
    await this.resolve(snippet, ultisnip)
    this.synchronize()
  }

  private async resolve(snippet: Snippets.TextmateSnippet, ultisnip?: UltiSnippetContext): Promise<void> {
    // let { snippet } = this.tmSnippet
    let { resolver, nvim } = this
    if (resolver) {
      await snippet.resolveVariables(resolver)
    }
    this._hasPython = hasPython(ultisnip) || snippet.hasPythonBlock
    if (ultisnip && ultisnip.noPython !== true) {
      let pyCodes: string[] = this.hasPython ? preparePythonCodes(ultisnip) : []
      await snippet.evalCodeBlocks(nvim, pyCodes)
    }
  }

  public getRanges(placeholder: CocSnippetPlaceholder): Range[] {
    if (placeholder.value.length == 0) return []
    let tmSnippet = placeholder.marker.parentSnippet
    let placeholders = this._placeholders.filter(o => o.index == placeholder.index && o.marker.parentSnippet === tmSnippet)
    return placeholders.map(o => o.range).filter(r => !emptyRange(r))
  }

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

  public get hasPython(): boolean {
    return this._hasPython
  }

  public resetStartPosition(pos: Position): void {
    this.position = pos
    this.synchronize()
  }

  public get start(): Position {
    return Object.assign({}, this.position)
  }

  public get range(): Range {
    return Range.create(this.position, getEnd(this.position, this._text))
  }

  public get text(): string {
    return this._text
  }

  public get finalCount(): number {
    return this._placeholders.filter(o => o.index == 0).length
  }

  public get placeholders(): ReadonlyArray<Snippets.Marker> {
    return this._placeholders.map(o => o.marker)
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | undefined {
    let index = 0
    for (let p of this._placeholders) {
      if (p.index == 0 || p.transform) continue
      if (index == 0 || p.index < index) {
        index = p.index
      }
    }
    return this.getPlaceholderByIndex(index)
  }

  public getPlaceholderByMarker(marker: Snippets.Marker): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.marker === marker)
  }

  public getPlaceholderByIndex(index: number): CocSnippetPlaceholder {
    let filtered = this._placeholders.filter(o => o.index == index && !o.transform)
    let find = filtered.find(o => o.primary)
    return defaultValue(find, filtered[0])
  }

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

  public getPlaceholderByRange(range: Range): CocSnippetPlaceholder {
    return this._placeholders.find(o => rangeInRange(range, o.range))
  }

  public async insertSnippet(placeholder: CocSnippetPlaceholder, snippet: string, parts: [string, string], ultisnip?: UltiSnippetContext): Promise<Snippets.Placeholder | Snippets.Variable> {
    if (ultisnip) {
      let { start, end } = placeholder.range
      this.nvim.setVar('coc_last_placeholder', {
        current_text: placeholder.value,
        start: { line: start.line, col: start.character, character: start.character },
        end: { line: end.line, col: end.character, character: end.character }
      }, true)
    }
    let select = this._tmSnippet.insertSnippet(snippet, placeholder.marker, parts, ultisnip)
    // TODO use insertNestedSnippet need synchronize upper snippet.
    await this.resolve(this._tmSnippet, ultisnip)
    this.synchronize()
    return select
  }

  /**
   * Check newText for placeholder.
   */
  public getNewText(placeholder: CocSnippetPlaceholder, inserted: string): string | undefined {
    let { before, after } = placeholder
    if (!inserted.startsWith(before)) return undefined
    if (inserted.length < before.length + after.length) return undefined
    if (!inserted.endsWith(after)) return undefined
    if (!after.length) return inserted.slice(before.length)
    return inserted.slice(before.length, - after.length)
  }

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
    await this._tmSnippet.update(this.nvim, marker, newText)
    if (token.isCancellationRequested) return undefined
    this.synchronize()
    let after = this.getTextBefore(marker, before)
    return { text: this._text, delta: getChangedPosition(cursor, TextEdit.replace(r, after)) }
  }

  public getTextBefore(marker: Snippets.Placeholder, defaultValue: string): string {
    let placeholder = this._placeholders.find(o => o.marker == marker)
    if (placeholder) return placeholder.before
    return defaultValue
  }

  public removeText(offset: number, length: number): boolean {
    let succeed = this._tmSnippet.deleteText(offset, length)
    if (succeed) this.synchronize()
    return succeed
  }

  public getTabStopInfo(): TabStopInfo[] {
    let res: TabStopInfo[] = []
    this._placeholders.forEach(p => {
      if (p.marker instanceof Snippets.Placeholder && (p.primary || p.index === 0)) {
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
    const { line, character } = this.position
    const document = TextDocument.create('untitled:/1', 'snippet', 0, snippet.toString())
    // let { placeholders, variables, maxIndexNumber } = snippet
    const placeholders: CocSnippetPlaceholder[] = []
    // all placeholders, including nested placeholder from snippet
    let offset = 0
    snippet.walk(marker => {
      if (marker instanceof Snippets.Placeholder) {
        const position = document.positionAt(offset)
        const start: Position = {
          line: line + position.line,
          character: position.line == 0 ? character + position.character : position.character
        }
        const value = marker.toString()
        const end = getEnd(position, value)
        let placeholder: CocSnippetPlaceholder = {
          index: marker.index,
          value,
          nestCount: marker.nestedPlaceholderCount,
          marker,
          transform: !!marker.transform,
          range: Range.create(start, getEnd(start, value)),
          // TODO not needed those
          before: document.getText(Range.create(Position.create(0, 0), position)),
          after: document.getText(Range.create(end, Position.create(document.lineCount, 0))),
          primary: marker.primary === true
        }
        placeholders.push(placeholder)
      }
      offset += marker.len()
      return true
    }, false)
    this._text = this._tmSnippet.toString()
    this._placeholders = placeholders
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
 * r in range, get text before and after
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

export function normalizeSnippetString(snippet: string, indent: string, opts: SnippetFormatOptions): string {
  let lines = snippet.split(/\r?\n/)
  let ind = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
  let tabSize = defaultValue(opts.tabSize, 2)
  let noExpand = opts.noExpand
  let trimTrailingWhitespace = opts.trimTrailingWhitespace
  lines = lines.map((line, idx) => {
    let space = line.match(/^\s*/)[0]
    let pre = space
    let isTab = space.startsWith('\t')
    if (isTab && opts.insertSpaces && !noExpand) {
      pre = ind.repeat(space.length)
    } else if (!isTab && !opts.insertSpaces) {
      pre = ind.repeat(space.length / tabSize)
    }
    return (idx == 0 || (trimTrailingWhitespace && line.length == 0) ? '' : indent) + pre + line.slice(space.length)
  })
  return lines.join('\n')
}

export function shouldFormat(snippet: string): boolean {
  if (/^\s/.test(snippet)) return true
  if (snippet.indexOf('\n') !== -1) return true
  return false
}

export function comparePlaceholder(a: { primary: boolean, index: number, nestCount: number }, b: { primary: boolean, index: number, nestCount: number }): number {
  // check inner placeholder first
  if (a.nestCount !== b.nestCount) return a.nestCount - b.nestCount
  if (a.primary !== b.primary) return a.primary ? -1 : 1
  return a.index - b.index
}

/**
 * TODO test
 */
export function getNextPlaceholder(marker: Snippets.Placeholder, forward: boolean): Snippets.Placeholder | undefined {
  let idx = marker.index
  if (idx <= 0) return undefined
  let arr: Snippets.Placeholder[] = []
  let min_index: number
  let max_index: number
  const snippet = marker.snippet
  snippet.walk(m => {
    if (m instanceof Snippets.Placeholder && (m.primary || m.isFinalTabstop)) {
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
  if (snippet.parent instanceof Snippets.Placeholder) {
    return getNextPlaceholder(snippet.parent, forward)
  }
  return undefined
}
