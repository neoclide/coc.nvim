import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { adjustPosition, comparePosition, editRange, getChangedPosition, rangeInRange, isSingleLine } from '../util/position'
import * as Snippets from "./parser"
import { VariableResolver } from './parser'
import { preparePythonCodes, UltiSnippetContext } from './eval'
import { byteLength } from '../util/string'
import { Neovim } from '@chemzqm/neovim'
const logger = require('../util/logger')('snippets-snipet')

export interface CocSnippetPlaceholder {
  id: number // unique index
  index: number | undefined
  marker: Snippets.Placeholder | Snippets.Variable
  // range in current buffer
  range: Range
  value: string
  transform: boolean
  isVariable: boolean
  primary: boolean
  choice?: string[]
}

export class CocSnippet {
  private _placeholders: CocSnippetPlaceholder[]
  public tmSnippet: Snippets.TextmateSnippet

  constructor(private _snippetString: string,
    private position: Position,
    private nvim: Neovim,
    private _variableResolver?: VariableResolver,
  ) {
  }

  public get placeholders(): ReadonlyArray<Snippets.Marker> {
    return this._placeholders.map(o => o.marker)
  }

  public async init(ultisnip?: UltiSnippetContext): Promise<void> {
    const parser = new Snippets.SnippetParser(!!ultisnip)
    const snippet = parser.parse(this._snippetString, true)
    this.tmSnippet = snippet
    await this.resolve(ultisnip)
    this.sychronize()
  }

  private async resolve(ultisnip?: UltiSnippetContext): Promise<void> {
    let { snippet } = this.tmSnippet
    let { _variableResolver, nvim } = this
    if (_variableResolver) {
      await snippet.resolveVariables(_variableResolver)
    }
    if (ultisnip) {
      let pyCodes: string[] = []
      if (snippet.hasPython) pyCodes = preparePythonCodes(ultisnip)
      await snippet.evalCodeBlocks(nvim, pyCodes)
    }
  }

  public adjustPosition(characterCount: number, lineCount: number): void {
    let { line, character } = this.position
    this.position = {
      line: line + lineCount,
      character: character + characterCount
    }
    this.sychronize()
  }

  // adjust for edit before snippet
  public adjustTextEdit(edit: TextEdit, changedLine?: string): boolean {
    let { range, newText } = edit
    if (comparePosition(this.range.start, range.end) < 0) {
      let { start, end } = range
      let overlaped = end.character - this.range.start.character
      // shift single line range to left as far as possible
      if (changedLine && comparePosition(this.range.start, start) > 0
        && isSingleLine(range)
        && start.character - overlaped >= 0
        && changedLine.slice(start.character - overlaped, start.character) ==
        changedLine.slice(this.range.start.character, this.range.start.character + overlaped)) {
        edit.range = range = Range.create(start.line, start.character - overlaped, end.line, end.character - overlaped)
      } else {
        return false
      }
    }

    // check change of placeholder at beginning
    if (!newText.includes('\n')
      && comparePosition(range.start, range.end) == 0
      && comparePosition(this.range.start, range.start) == 0) {
      let idx = this._placeholders.findIndex(o => comparePosition(o.range.start, range.start) == 0)
      if (idx !== -1) return false
    }
    let changed = getChangedPosition(this.range.start, edit)
    if (changed.line == 0 && changed.character == 0) return true
    this.adjustPosition(changed.character, changed.line)
    return true
  }

  public get finalCount(): number {
    return this._placeholders.filter(o => o.index == 0).length
  }

  /**
   * Current range in doucment
   */
  public get range(): Range {
    let start = this.position
    const content = this.tmSnippet.toString()
    const lines = content.split(/\r?\n/)
    const len = lines.length
    const lastLine = lines[len - 1]
    const end = len == 1 ? start.character + content.length : lastLine.length
    return Range.create(start, Position.create(start.line + len - 1, end))
  }

  public toString(): string {
    return this.tmSnippet.toString()
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | undefined {
    let index = 0
    for (let p of this._placeholders) {
      if (p.index == 0) continue
      if (index == 0 || p.index < index) {
        index = p.index
      }
    }
    return this.getPlaceholder(index)
  }

  public getPlaceholderByMarker(marker: Snippets.Marker): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.marker === marker)
  }

  public getPlaceholder(index: number): CocSnippetPlaceholder {
    let placeholders = this._placeholders.filter(o => o.index == index)
    let filtered = placeholders.filter(o => !o.transform)
    let find = filtered.find(o => o.primary) || filtered[0]
    return find ?? placeholders[0]
  }

  public getPrevPlaceholder(index: number): CocSnippetPlaceholder | undefined {
    if (index <= 1) return undefined
    let placeholders = this._placeholders.filter(o => !o.transform && o.index < index && o.index != 0)
    let find: CocSnippetPlaceholder
    while (index > 1) {
      index = index - 1
      let arr = placeholders.filter(o => o.index == index)
      if (arr.length) {
        find = arr.find(o => o.primary) || arr[0]
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

  public async insertSnippet(placeholder: CocSnippetPlaceholder, snippet: string, range: Range, ultisnip?: UltiSnippetContext): Promise<Snippets.Placeholder> {
    let { start } = placeholder.range
    // let offset = position.character - start.character
    let editStart = Position.create(
      range.start.line - start.line,
      range.start.line == start.line ? range.start.character - start.character : range.start.character
    )
    let editEnd = Position.create(
      range.end.line - start.line,
      range.end.line == start.line ? range.end.character - start.character : range.end.character
    )
    let editRange = Range.create(editStart, editEnd)
    let select = this.tmSnippet.insertSnippet(snippet, placeholder.marker, editRange, !!ultisnip)
    await this.resolve(ultisnip)
    this.sychronize()
    return select
  }

  /**
   * Current line text before marker
   */
  public getContentBefore(marker: Snippets.Marker): string {
    let res = ''
    const calc = (m: Snippets.Marker): void => {
      let p = m.parent
      if (!p) return
      let s = ''
      for (let b of p.children) {
        if (b === m) break
        s = s + b.toString()
      }
      if (s.indexOf('\n') !== -1) {
        let arr = s.split(/\n/)
        res = arr[arr.length - 1] + res
        return
      }
      res = s + res
      calc(p)
    }
    calc(marker)
    return res
  }

  // update internal positions, no change of buffer
  // return TextEdit list when needed
  public async updatePlaceholder(placeholder: CocSnippetPlaceholder, edit: TextEdit): Promise<{ edits: TextEdit[]; delta: number }> {
    let { range } = this
    let { value, marker } = placeholder
    let newText = editRange(placeholder.range, value, edit)
    let lineChanged = newText.indexOf('\n') !== -1
    let before = this.getContentBefore(marker)
    await this.tmSnippet.update(this.nvim, marker, newText)
    let after = this.getContentBefore(marker)
    let snippetEdit: TextEdit = {
      range: Range.create(range.start, adjustPosition(range.end, edit)),
      newText: this.tmSnippet.toString()
    }
    this.sychronize()
    return { edits: [snippetEdit], delta: lineChanged ? 0 : byteLength(after) - byteLength(before) }
  }

  private sychronize(): void {
    const snippet = this.tmSnippet
    const { line, character } = this.position
    const document = TextDocument.create('untitled:/1', 'snippet', 0, snippet.toString())
    const { placeholders, variables, maxIndexNumber } = snippet
    const variableIndexMap: Map<string, number> = new Map()
    let variableIndex = maxIndexNumber + 1

    this._placeholders = [...placeholders, ...variables].map((p, idx) => {
      const offset = snippet.offset(p)
      const position = document.positionAt(offset)
      const start: Position = {
        line: line + position.line,
        character: position.line == 0 ? character + position.character : position.character
      }
      let index: number
      if (p instanceof Snippets.Variable) {
        let key = p.name
        if (variableIndexMap.has(key)) {
          index = variableIndexMap.get(key)
        } else {
          variableIndexMap.set(key, variableIndex)
          index = variableIndex
          variableIndex = variableIndex + 1
        }
        // variableIndex = variableIndex + 1
      } else {
        index = p.index
      }
      const value = p.toString()
      const lines = value.split(/\r?\n/)
      let res: CocSnippetPlaceholder = {
        range: Range.create(start, {
          line: start.line + lines.length - 1,
          character: lines.length == 1 ? start.character + value.length : lines[lines.length - 1].length
        }),
        id: idx,
        index,
        value,
        marker: p,
        transform: p.transform != null,
        primary: p instanceof Snippets.Placeholder && p.primary === true,
        isVariable: p instanceof Snippets.Variable
      }
      Object.defineProperty(res, 'snippet', {
        enumerable: false
      })
      if (p instanceof Snippets.Placeholder && p.choice) {
        let { options } = p.choice
        if (options && options.length) {
          res.choice = options.map(o => o.value)
        }
      }
      return res
    })
  }
}
