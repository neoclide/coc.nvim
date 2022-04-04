import { Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'

export function computeLinesOffsets(lines: ReadonlyArray<string>, eol: boolean): number[] {
  const result: number[] = []
  let textOffset = 0
  for (let line of lines) {
    result.push(textOffset)
    textOffset += line.length + 1
  }
  if (eol) result.push(textOffset)
  return result
}

/**
 * Represents a line of text, such as a line of source code.
 *
 * TextLine objects are __immutable__. When a {@link TextDocument document} changes,
 * previously retrieved lines will not represent the latest state.
 */
export class TextLine {

  private readonly _line: number
  private readonly _text: string
  private readonly _isLastLine: boolean

  constructor(line: number, text: string, isLastLine: boolean) {
    this._line = line
    this._text = text
    this._isLastLine = isLastLine
  }

  /**
   * The zero-based line number.
   */
  public get lineNumber(): number {
    return this._line
  }

  /**
   * The text of this line without the line separator characters.
   */
  public get text(): string {
    return this._text
  }

  /**
   * The range this line covers without the line separator characters.
   */
  public get range(): Range {
    return Range.create(this._line, 0, this._line, this._text.length)
  }

  /**
   * The range this line covers with the line separator characters.
   */
  public get rangeIncludingLineBreak(): Range {
    return this._isLastLine ? this.range : Range.create(this._line, 0, this._line + 1, 0)
  }

  /**
   * The offset of the first character which is not a whitespace character as defined
   * by `/\s/`. **Note** that if a line is all whitespace the length of the line is returned.
   */
  public get firstNonWhitespaceCharacterIndex(): number {
    // TODO@api, rename to 'leadingWhitespaceLength'
    return /^(\s*)/.exec(this._text)![1].length
  }

  /**
   * Whether this line is whitespace only, shorthand
   * for {@link TextLine.firstNonWhitespaceCharacterIndex} === {@link TextLine.text TextLine.text.length}.
   */
  public get isEmptyOrWhitespace(): boolean {
    return this.firstNonWhitespaceCharacterIndex === this._text.length
  }
}

/**
 * Text document that created with readonly lines.
 *
 * Created for save memory since we could reuse readonly lines.
 */
export class LinesTextDocument implements TextDocument {
  private _lineOffsets: number[] | undefined
  private _content: string
  constructor(
    public readonly uri: string,
    public readonly languageId: string,
    public readonly version: number,
    public lines: ReadonlyArray<string>,
    public readonly bufnr: number,
    private eol: boolean
  ) {
  }

  private get content(): string {
    if (!this._content) {
      this._content = this.lines.join('\n') + (this.eol ? '\n' : '')
    }
    return this._content
  }

  public get end(): Position {
    let line = this.lineCount - 1
    if (this.eol) return Position.create(line, 0)
    return Position.create(line, this.lines[line].length)
  }

  public get lineCount(): number {
    return this.lines.length + (this.eol ? 1 : 0)
  }

  public getText(range?: Range): string {
    if (range) {
      const start = this.offsetAt(range.start)
      const end = this.offsetAt(range.end)
      return this.content.substring(start, end)
    }
    return this.content
  }

  public lineAt(lineOrPos: number | Position): TextLine {
    const line = Position.is(lineOrPos) ? lineOrPos.line : lineOrPos
    if (typeof line !== 'number' ||
      line < 0 ||
      line >= this.lineCount ||
      Math.floor(line) !== line) {
      throw new Error('Illegal value for `line`')
    }

    return new TextLine(line, this.lines[line] ?? '', line === this.lineCount - 1)
  }

  public positionAt(offset: number): Position {
    offset = Math.max(Math.min(offset, this.content.length), 0)
    let lineOffsets = this.getLineOffsets()
    let low = 0
    let high = lineOffsets.length
    if (high === 0) {
      return { line: 0, character: offset }
    }
    while (low < high) {
      let mid = Math.floor((low + high) / 2)
      if (lineOffsets[mid] > offset) {
        high = mid
      } else {
        low = mid + 1
      }
    }
    // low is the least x for which the line offset is larger than the current offset
    // or array.length if no line offset is larger than the current offset
    let line = low - 1
    return { line, character: offset - lineOffsets[line] }
  }

  public offsetAt(position: Position) {
    let lineOffsets = this.getLineOffsets()
    if (position.line >= lineOffsets.length) {
      return this.content.length
    } else if (position.line < 0) {
      return 0
    }
    let lineOffset = lineOffsets[position.line]
    let nextLineOffset = (position.line + 1 < lineOffsets.length) ? lineOffsets[position.line + 1] : this.content.length
    return Math.max(Math.min(lineOffset + position.character, nextLineOffset), lineOffset)
  }

  private getLineOffsets(): number[] {
    if (this._lineOffsets === undefined) {
      this._lineOffsets = computeLinesOffsets(this.lines, this.eol)
    }
    return this._lineOffsets
  }
}
