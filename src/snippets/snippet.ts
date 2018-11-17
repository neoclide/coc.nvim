import { Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { equals } from '../util/object'
import { comparePosition, emptyRange, isSingleLine, rangeInRange } from '../util/position'
import * as Snippets from "./parser"
import { VariableResolver } from './parser'
const logger = require('../util/logger')('snippets-snipet')

export interface CocSnippetPlaceholder {
  index: number
  id: number // unique index
  line: number
  // range in current buffer
  range: Range
  value: string
  isFinalTabstop: boolean
  choice?: string[]
  snippet: CocSnippet
}

export class CocSnippet {
  private _parser: Snippets.SnippetParser = new Snippets.SnippetParser()
  private _placeholders: CocSnippetPlaceholder[]
  private tmSnippet: Snippets.TextmateSnippet

  constructor(private _snippetString: string,
    private position: Position,
    private _variableResolver?: VariableResolver) {
    const snippet = this._parser.parse(this._snippetString, true)
    if (this._variableResolver) {
      snippet.resolveVariables(this._variableResolver)
    }
    this.tmSnippet = snippet
    this.update()
  }

  public get offset(): Position {
    return this.position
  }

  public adjustPosition(characterCount: number, lineCount: number): void {
    let { line, character } = this.position
    this.position = {
      line: line + lineCount,
      character: character + characterCount
    }
    this.update()
  }

  public adjustTextEdit(edit: TextEdit): boolean {
    let { range, newText } = edit
    let { start } = this.range
    if (comparePosition(range.end, start) <= 0) {
      let lines = newText.split('\n')
      let lineCount = lines.length - (range.end.line - range.start.line) - 1
      let characterCount = 0
      if (range.end.line == start.line) {
        let single = isSingleLine(range) && lineCount == 0
        let removed = single ? range.end.character - range.start.character : range.end.character
        let added = single ? newText.length : lines[lines.length - 1].length
        characterCount = added - removed
      }
      this.adjustPosition(characterCount, lineCount)
      return true
    }
    return false
  }

  public contains(range: Range): boolean {
    return rangeInRange(range, this.range)
  }

  public get isPlainText(): boolean {
    return this._placeholders.every(p => p.isFinalTabstop)
  }

  public toString(): string {
    return this.tmSnippet.toString()
  }

  public get range(): Range {
    let end = this._placeholders.reduce((pos, p) => {
      return comparePosition(p.range.end, pos) > 0 ? p.range.end : pos
    }, this.position)
    return Range.create(this.position, end)
  }

  // get placeholders for jump, including finalPlaceholder
  public getJumpPlaceholders(): CocSnippetPlaceholder[] {
    return this._placeholders.reduce((arr, curr) => {
      let idx = arr.findIndex(o => o.index == curr.index)
      if (idx == -1) arr.push(curr)
      return arr
    }, [])
  }

  public get line(): number {
    return this.position.line
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | null {
    return this.getPlaceholder(this.tmSnippet.minIndexNumber)
  }

  public findNextPlaceholder(position: Position): CocSnippetPlaceholder {
    let placeholders = this.getJumpPlaceholders()
    for (let p of placeholders) {
      if (comparePosition(p.range.start, position) > 0) {
        return p
      }
    }
    return this.finalPlaceholder
  }

  public findPrevPlaceholder(position: Position): CocSnippetPlaceholder {
    let placeholders = this.getJumpPlaceholders()
    for (let p of placeholders) {
      if (comparePosition(p.range.end, position) < 0) {
        return p
      }
    }
    return this.firstPlaceholder
  }

  public get lastPlaceholder(): CocSnippetPlaceholder {
    return this.getPlaceholder(this.tmSnippet.maxIndexNumber) || this.finalPlaceholder
  }

  public getPlaceholderById(id: number): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.id == id)
  }

  public getPlaceholder(index: number): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.index == index)
  }

  public getPrevPlaceholder(index: number): CocSnippetPlaceholder {
    if (index == 0) return this.lastPlaceholder
    if (index < 0) return null
    let prev = this.getPlaceholder(index - 1)
    if (!prev) return this.getPrevPlaceholder(index - 1)
    return prev
  }

  public getNextPlaceholder(index: number): CocSnippetPlaceholder {
    let max = this.tmSnippet.maxIndexNumber
    if (index == max) return this.finalPlaceholder
    let next = this.getPlaceholder(index + 1)
    if (!next) return this.getNextPlaceholder(index + 1)
    return next
  }

  public get finalPlaceholder(): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.isFinalTabstop)
  }

  public findPlaceholder(range: Range): CocSnippetPlaceholder | null {
    let placeholders = this._placeholders.filter(o => rangeInRange(range, o.range))
    return this.selectPlaceholder(placeholders)
  }

  public insertSnippet(placeholder: CocSnippetPlaceholder, snippet: string, position: Position): number {
    let { start } = placeholder.range
    let offset = position.character - start.character
    let insertFinal = true
    let next = this._placeholders[placeholder.id + 1]
    if (next && equals(next.range.start, position)) {
      insertFinal = false
    }
    let first = this.tmSnippet.insertSnippet(snippet, placeholder.id, offset, insertFinal)
    this.update()
    return first
  }

  // Use inner most and previous if adjacent
  private selectPlaceholder(placeholders: CocSnippetPlaceholder[]): CocSnippetPlaceholder {
    if (placeholders.length <= 1) return placeholders[0] || null
    placeholders.sort((a, b) => {
      let d = a.range.start.character - b.range.start.character
      if (d != 0) return d
      return b.range.end.character - a.range.end.character
    })
    let placeholder: CocSnippetPlaceholder
    // = placeholders[0]
    for (let p of placeholders) {
      if (placeholder && rangeInRange(p.range, placeholder.range)) {
        if (emptyRange(p.range) && equals(p.range.start, placeholder.range.end)) {
          break
        }
        placeholder = p
      }
      if (!placeholder) placeholder = p
    }
    return placeholder
  }

  // update internal positions, no change of buffer
  // return TextEdit list when needed
  public updatePlaceholder(placeholder: CocSnippetPlaceholder, edit: TextEdit): TextEdit[] {
    let { range } = edit
    let { start, end } = range
    let pRange = placeholder.range
    let { value, index, id } = placeholder
    let endPart = pRange.end.character > end.character ? value.slice(end.character - pRange.end.character) : ''
    let newText = `${value.slice(0, start.character - pRange.start.character)}${edit.newText}${endPart}`
    // update with current change
    this.setPlaceholderValue(id, newText)
    let placeholders = this._placeholders.filter(o => o.index == index && o.id != id)
    if (!placeholders.length) return []
    let edits: TextEdit[] = placeholders.map(p => {
      return {
        range: p.range,
        newText
      }
    })
    // update with others
    placeholders.forEach(p => {
      this.tmSnippet.updatePlaceholder(p.id, newText)
    })
    this.update()
    return edits
  }

  private update(): void {
    const snippet = this.tmSnippet
    const placeholders = snippet.placeholders
    const { line, character } = this.position
    const document = TextDocument.create('untitled://1', 'snippet', 0, snippet.toString())

    this._placeholders = placeholders.map((p, idx) => {
      const offset = snippet.offset(p)
      const position = document.positionAt(offset)
      const start: Position = {
        line: line + position.line,
        character: position.line == 0 ? character + position.character : position.character
      }
      const value = p.toString()
      let res: CocSnippetPlaceholder = {
        range: Range.create(start, {
          line: start.line,
          character: start.character + value.length
        }),
        line: start.line,
        id: idx,
        index: p.index,
        value,
        isFinalTabstop: p.isFinalTabstop,
        snippet: this
      }
      Object.defineProperty(res, 'snippet', {
        enumerable: false
      })
      if (p.choice) {
        let { options } = p.choice
        if (options && options.length) {
          res.choice = options.map(o => o.value)
        }
      }
      return res
    })
  }

  private setPlaceholderValue(id: number, val: string): void {
    this.tmSnippet.updatePlaceholder(id, val)
    this.update()
  }
}
