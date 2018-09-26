import * as Snippets from "vscode-snippet-parser/lib"

export type VariableResolver = Snippets.VariableResolver
export type Variable = Snippets.Variable

export interface CocSnippetPlaceholder {
  index: number

  // Zero-based line relative to the start of the snippet
  line: number

  // Zero-based start character
  character: number

  value: string

  isFinalTabstop: boolean

  choice?: string[]
}

export const getLineCharacterFromOffset = (
  offset: number,
  lines: string[],
): { line: number; character: number } => {
  let idx = 0
  let currentOffset = 0
  while (idx < lines.length) {
    if (offset >= currentOffset && offset <= currentOffset + lines[idx].length) {
      return { line: idx, character: offset - currentOffset }
    }

    currentOffset += lines[idx].length + 1
    idx++
  }

  return { line: -1, character: -1 }
}

export class CocSnippet {
  private _parser: Snippets.SnippetParser = new Snippets.SnippetParser()
  private _placeholderValues: { [index: number]: string } = {}
  private _snippetString: string

  constructor(snippet: string, private _variableResolver?: VariableResolver) {
    this._snippetString = normalizeNewLines(snippet)
  }

  public setPlaceholder(index: number, newValue: string): void {
    this._placeholderValues[index] = newValue
  }

  public getPlaceholderValue(index: number): string {
    return this._placeholderValues[index] || ""
  }

  public getPlaceholders(): CocSnippetPlaceholder[] {
    const snippet = this._getSnippetWithFilledPlaceholders()
    const placeholders = snippet.placeholders

    const lines = this.getLines()

    const cocPlaceholders = placeholders.map(p => {
      const offset = snippet.offset(p)
      const position = getLineCharacterFromOffset(offset, lines)

      let res: CocSnippetPlaceholder = {
        ...position,
        index: p.index,
        value: p.toString(),
        isFinalTabstop: p.isFinalTabstop,
      }
      if (p.choice) {
        let { options } = p.choice
        if (options && options.length) {
          res.choice = options.map(o => o.value)
        }
      }
      return res
    })

    return cocPlaceholders
  }

  public getLines(): string[] {
    const normalizedSnippetString = this._getNormalizedSnippet()

    return normalizedSnippetString.split("\n")
  }

  private _getSnippetWithFilledPlaceholders(): Snippets.TextmateSnippet {
    const snippet = this._parser.parse(this._snippetString, true, true)

    if (this._variableResolver) {
      snippet.resolveVariables(this._variableResolver)
    }

    Object.keys(this._placeholderValues).forEach((key: string) => {
      const val = this._placeholderValues[key]
      const snip = this._parser.parse(val)

      const placeholderToReplace = snippet.placeholders.filter(
        p => p.index.toString() === key,
      )

      placeholderToReplace.forEach(rep => {
        const placeHolder = new Snippets.Placeholder(rep.index)
        placeHolder.appendChild(snip)
        snippet.replace(rep, [placeHolder])
      })
    })

    return snippet
  }

  private _getNormalizedSnippet(): string {
    const snippetString = this._getSnippetWithFilledPlaceholders().toString()
    const normalizedSnippetString = snippetString.replace("\r\n", "\n")

    return normalizedSnippetString
  }
}

function normalizeNewLines(str: string): string {
  return str.split("\r\n").join("\n")
}

