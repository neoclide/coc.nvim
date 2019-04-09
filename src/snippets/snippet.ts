import { Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { equals } from '../util/object'
import { getChangedPosition, rangeInRange, comparePosition, adjustPosition, editRange } from '../util/position'
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
  transform: boolean
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
    if (_variableResolver) {
      snippet.resolveVariables(_variableResolver)
    }
    this.tmSnippet = snippet
    this.update()
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
    let { range } = edit
    if (comparePosition(this.range.start, range.end) < 0) return false
    let changed = getChangedPosition(this.range.start, edit)
    if (changed.line == 0 && changed.character == 0) return true
    this.adjustPosition(changed.character, changed.line)
    return true
  }

  public get isPlainText(): boolean {
    return this._placeholders.every(p => p.isFinalTabstop)
  }

  public toString(): string {
    return this.tmSnippet.toString()
  }

  public get range(): Range {
    let { position } = this
    const content = this.tmSnippet.toString()
    const doc = TextDocument.create('untitled:/1', 'snippet', 0, content)
    const pos = doc.positionAt(content.length)
    const end = pos.line == 0 ? position.character + pos.character : pos.character
    return Range.create(position, Position.create(position.line + pos.line, end))
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | null {
    return this.getPlaceholder(this.tmSnippet.minIndexNumber)
  }

  public get lastPlaceholder(): CocSnippetPlaceholder {
    return this.getPlaceholder(this.tmSnippet.maxIndexNumber)
  }

  public getPlaceholderById(id: number): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.id == id)
  }

  public getPlaceholder(index: number): CocSnippetPlaceholder {
    let placeholders = this._placeholders.filter(o => o.index == index)
    let filtered = placeholders.filter(o => !o.transform)
    return filtered.length ? filtered[0] : placeholders[0]
  }

  public getPrevPlaceholder(index: number): CocSnippetPlaceholder {
    if (index == 0) return this.lastPlaceholder
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

  public getPlaceholderByRange(range: Range): CocSnippetPlaceholder {
    return this._placeholders.find(o => {
      return rangeInRange(range, o.range)
    })
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

  // update internal positions, no change of buffer
  // return TextEdit list when needed
  public updatePlaceholder(placeholder: CocSnippetPlaceholder, edit: TextEdit): TextEdit[] {
    let { start, end } = edit.range
    let { range } = this
    let { value, id } = placeholder
    let newText = editRange(placeholder.range, value, edit)
    this.tmSnippet.updatePlaceholder(id, newText)
    let endPosition = adjustPosition(range.end, edit)
    let snippetEdit: TextEdit = {
      range: Range.create(range.start, endPosition),
      newText: this.tmSnippet.toString()
    }
    this.update()
    return [snippetEdit]
  }

  private update(): void {
    const snippet = this.tmSnippet
    const placeholders = snippet.placeholders
    const { line, character } = this.position
    const document = TextDocument.create('untitled:/1', 'snippet', 0, snippet.toString())

    this._placeholders = placeholders.map((p, idx) => {
      const offset = snippet.offset(p)
      const position = document.positionAt(offset)
      const start: Position = {
        line: line + position.line,
        character: position.line == 0 ? character + position.character : position.character
      }
      const value = p.toString()
      const lines = value.split('\n')
      let res: CocSnippetPlaceholder = {
        range: Range.create(start, {
          line: start.line + lines.length - 1,
          character: lines.length == 1 ? start.character + value.length : lines[lines.length - 1].length
        }),
        transform: p.transform != null,
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
}
