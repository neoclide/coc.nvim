import * as Snippets from "./parser"
import { Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
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
  private _parentSnippet: CocSnippet
  private _parentPlaceholderId: number
  private childSnippetsMap: Map<number, CocSnippet> = new Map()
  private singLine: boolean
  private tmSnippet: Snippets.TextmateSnippet

  constructor(private _snippetString: string,
    private position: Position,
    private _variableResolver?: VariableResolver) {
    const snippet = this._parser.parse(this._snippetString, true, true)
    if (this._variableResolver) {
      snippet.resolveVariables(this._variableResolver)
    }
    this.tmSnippet = snippet
    this._placeholders = this.getPlaceholders()
    this.singLine = _snippetString.indexOf('\n') == -1
  }

  public setChildSnippet(id: number, snippet: CocSnippet | null): void {
    if (snippet) {
      this.childSnippetsMap.set(id, snippet)
    } else {
      this.childSnippetsMap.delete(id)
    }
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
    this._placeholders = this.getPlaceholders()
  }

  public get children(): CocSnippet[] {
    return Array.from(this.childSnippetsMap.values())
  }

  // get placeholders for jump, including finalPlaceholder
  public getJumpPlaceholders(): CocSnippetPlaceholder[] {
    return this._placeholders.reduce((arr, curr) => {
      let idx = arr.findIndex(o => o.index == curr.index)
      if (idx == -1 && this.childSnippetsMap.get(curr.id) == null) arr.push(curr)
      return arr
    }, [] as CocSnippetPlaceholder[])
  }

  public get line(): number {
    return this.position.line
  }

  public get firstPlaceholder(): CocSnippetPlaceholder | null {
    return this._placeholders.find(o => o.id == 0)
  }

  public get lastIndex(): number {
    return this._placeholders.reduce((n, cur) => Math.max(n, cur.index), 0)
  }

  public get lastPlaceholder(): CocSnippetPlaceholder | null {
    return this.getPlaceholder(this.lastIndex)
  }

  public getPlaceholderById(id: number): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.id == id)
  }

  public getPlaceholder(index: number): CocSnippetPlaceholder {
    if (index == -1) return this.finalPlaceholder
    return this._placeholders.find(o => o.index == index)
  }

  public get finalPlaceholder(): CocSnippetPlaceholder {
    return this._placeholders.find(o => o.isFinalTabstop)
  }

  // update internal positions, no change of buffer
  // return TextEdit list when needed
  public updatePlaceholder(placeholder: CocSnippetPlaceholder, edit: TextEdit): TextEdit[] | false {
    let { range } = edit
    let { start, end } = range
    let pRange = placeholder.range
    if (start.character < pRange.start.character || end.character > pRange.end.character) {
      logger.error('Edit range miss match', edit.range)
      return false
    }
    let { value, index, id } = placeholder
    let endPart = pRange.end.character > end.character ? value.slice(end.character - pRange.end.character) : ''
    let newText = `${value.slice(0, start.character - pRange.start.character)}${edit.newText}${endPart}`
    // update with current change
    this._setPlaceholderValue(id, newText)
    this._placeholders = this.getPlaceholders()
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
      this._setPlaceholderValue(p.id, newText)
    })
    this._placeholders = this.getPlaceholders()
    return edits
  }

  private getPlaceholders(): CocSnippetPlaceholder[] {
    const snippet = this.tmSnippet
    const placeholders = snippet.placeholders
    const { line, character } = this.position
    const document = TextDocument.create('untitled://1', 'snippet', 0, snippet.toString())

    const cocPlaceholders = placeholders.map((p, idx) => {
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
    // sort by index
    cocPlaceholders.sort((a, b) => {
      if (a.isFinalTabstop) return 1
      if (b.isFinalTabstop) return -1
      return a.index - b.index
    })
    return cocPlaceholders
  }

  public toString(): string {
    return this.tmSnippet.toString()
  }

  private _setPlaceholderValue(id: number, val: string): void {
    const snip = this._parser.parse(val, false, false)
    const rep = this.tmSnippet.placeholders[id]
    const placeholder = new Snippets.Placeholder(rep.index)
    placeholder.appendChild(snip)
    this.tmSnippet.replace(rep, [placeholder])
  }

  public getParent(): CocSnippet | null {
    return this._parentSnippet
  }

  public connect(placeholder: CocSnippetPlaceholder): void {
    if (!this.singLine) return
    this._parentSnippet = placeholder.snippet
    this._parentPlaceholderId = placeholder.id
    this._parentSnippet.setChildSnippet(placeholder.id, this)
  }

  public disconnect(): void {
    if (!this._parentSnippet) return
    let snippet = this._parentSnippet
    snippet.setChildSnippet(this._parentPlaceholderId, null)
    this._parentSnippet = null
  }

  public get range(): Range {
    let finalPlaceholder = this.finalPlaceholder
    return Range.create(this.position, finalPlaceholder.range.end)
  }

  public get parentPlaceholder(): CocSnippetPlaceholder | null {
    if (!this._parentSnippet) return null
    return this._parentSnippet.getPlaceholderById(this._parentPlaceholderId)
  }
}
