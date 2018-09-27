import { Buffer, Neovim } from '@chemzqm/neovim'
import { Emitter, Event, FormattingOptions, Position, Range, TextDocumentContentChangeEvent, TextEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Document from '../model/document'
import { wait, isLineEdit } from '../util'
import workspace from '../workspace'
import { CocSnippet, CocSnippetPlaceholder } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"

const logger = require('../util/logger')('snippets-session')

export const splitLineAtPosition = (line: string, position: number): [string, string] => {
  const prefix = line.substring(0, position)
  const post = line.substring(position, line.length)
  return [prefix, post]
}

export const getFirstPlaceholder = (
  placeholders: CocSnippetPlaceholder[],
): CocSnippetPlaceholder => {
  return placeholders.reduce((prev: CocSnippetPlaceholder, curr: CocSnippetPlaceholder) => {
    if (!prev || prev.isFinalTabstop) {
      return curr
    }

    if (curr.index < prev.index && !curr.isFinalTabstop) {
      return curr
    }
    return prev
  }, null)
}

export const getPlaceholderByIndex = (
  placeholders: CocSnippetPlaceholder[],
  index: number,
): CocSnippetPlaceholder | null => {
  const matchingPlaceholders = placeholders.filter(p => p.index === index)

  if (matchingPlaceholders.length === 0) {
    return null
  }

  return matchingPlaceholders[0]
}

export const getFinalPlaceholder = (
  placeholders: CocSnippetPlaceholder[],
): CocSnippetPlaceholder | null => {
  const matchingPlaceholders = placeholders.filter(p => p.isFinalTabstop)

  if (matchingPlaceholders.length === 0) {
    return null
  }

  return matchingPlaceholders[0]
}

export interface IMirrorCursorUpdateEvent {
  mode: string
  cursors: Range[]
}

export const makeSnippetConsistentWithExistingWhitespace = (
  snippet: string,
  opts: FormattingOptions
) => {
  let indent = (new Array(opts.tabSize || 2)).fill(opts.insertSpaces ? ' ' : '\t').join('')
  return snippet.split("\t").join(indent)
}

export const makeSnippetIndentationConsistent = (snippet: string, indent: string) => {
  return snippet
    .split("\n")
    .map((line, index) => {
      if (index === 0) {
        return line
      } else {
        return indent + line
      }
    })
    .join("\n")
}

export class SnippetSession {
  private _document: Document
  private _snippet: CocSnippet
  private _position: Position
  // Get state of line where we inserted
  private _prefix: string
  private _suffix: string
  private _changedtick: number
  private _currentPlaceholder: CocSnippetPlaceholder = null
  private _lastCursorMoved: IMirrorCursorUpdateEvent
  private _onCancelEvent = new Emitter<void>()
  private _onCursorMoved = new Emitter<IMirrorCursorUpdateEvent>()

  public get document(): Document {
    return this._document
  }

  public get changedtick(): number {
    return this._changedtick
  }

  public get onCancel(): Event<void> {
    return this._onCancelEvent.event
  }

  public get onCursorMoved(): Event<IMirrorCursorUpdateEvent> {
    return this._onCursorMoved.event
  }

  public get position(): Position {
    return this._position
  }

  public get lines(): string[] {
    return this._snippet.getLines()
  }

  private get buffer(): Buffer {
    return this.document.buffer
  }

  constructor(private nvim: Neovim, private _snippetString: string) { }

  public async start(): Promise<void> {
    let position = await workspace.getCursorPosition()
    let document = this._document = await workspace.document
    let formatOptions = await workspace.getFormatOptions(this.document.uri)
    const currentLine = this.document.getline(position.line)
    this._position = position

    const [prefix, suffix] = splitLineAtPosition(currentLine, position.character)
    const currentIndent = currentLine.match(/^\s*/)[0]

    this._prefix = prefix
    this._suffix = suffix

    const normalizedSnippet = makeSnippetConsistentWithExistingWhitespace(
      this._snippetString,
      formatOptions,
    )
    const indentedSnippet = makeSnippetIndentationConsistent(normalizedSnippet, currentIndent)

    this._snippet = new CocSnippet(indentedSnippet, new SnippetVariableResolver(position.line, Uri.parse(document.uri).fsPath))

    const snippetLines = this._snippet.getLines()
    const lastIndex = snippetLines.length - 1
    snippetLines[0] = this._prefix + snippetLines[0]
    snippetLines[lastIndex] = snippetLines[lastIndex] + this._suffix

    await this.buffer.setLines(snippetLines, {
      start: position.line,
      end: position.line + 1,
      strictIndexing: false
    })

    const placeholders = this._snippet.getPlaceholders()

    if (!placeholders || placeholders.length === 0) {
      // If no placeholders, we're done with the session
      this._finish()
      return
    }

    await this.nextPlaceholder()
    await this.updateCursorPosition()
  }

  public async nextPlaceholder(): Promise<void> {
    await this.forceSync()
    const placeholders = this._snippet.getPlaceholders()

    if (!this._currentPlaceholder) {
      const newPlaceholder = getFirstPlaceholder(placeholders)
      this._currentPlaceholder = newPlaceholder
    } else {
      if (this._currentPlaceholder.isFinalTabstop) {
        this._finish()
        return
      }

      const nextPlaceholder = getPlaceholderByIndex(
        placeholders,
        this._currentPlaceholder.index + 1,
      )
      this._currentPlaceholder = nextPlaceholder || getFinalPlaceholder(placeholders)
    }

    await this.selectPlaceholder(this._currentPlaceholder)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSync()
    const placeholders = this._snippet.getPlaceholders()

    const nextPlaceholder = getPlaceholderByIndex(
      placeholders,
      this._currentPlaceholder.index - 1,
    )
    this._currentPlaceholder = nextPlaceholder || getFirstPlaceholder(placeholders)

    await this.selectPlaceholder(this._currentPlaceholder)
  }

  public async setPlaceholderValue(index: number, val: string): Promise<void> {
    const previousValue = this._snippet.getPlaceholderValue(index)

    if (previousValue === val) {
      logger.debug('Skipping because new placeholder value is same as previous')
      return
    }

    this._snippet.setPlaceholder(index, val)
    // Update current placeholder
    this._currentPlaceholder = getPlaceholderByIndex(this._snippet.getPlaceholders(), index)
    await this._updateSnippet()
  }

  // Update the cursor position relative to all placeholders
  public async updateCursorPosition(): Promise<void> {
    const pos = await workspace.getCursorPosition()

    const { mode } = await this.nvim.mode

    if (!this._currentPlaceholder ||
      pos.line !== this._currentPlaceholder.line + this._position.line
    ) {
      return
    }

    const boundsForPlaceholder = this._getBoundsForPlaceholder()

    const offset = pos.character - boundsForPlaceholder.start

    const allPlaceholdersAtIndex = this._snippet
      .getPlaceholders()
      .filter(
        f =>
          f.index === this._currentPlaceholder.index &&
          !(
            f.line === this._currentPlaceholder.line &&
            f.character === this._currentPlaceholder.character
          ),
      )

    const cursorPositions: Range[] = allPlaceholdersAtIndex.map(p => {
      if (mode === 's') {
        const bounds = this._getBoundsForPlaceholder(p)
        return Range.create(
          bounds.line,
          bounds.start,
          bounds.line,
          bounds.start + bounds.length,
        )
      } else {
        const bounds = this._getBoundsForPlaceholder(p)
        return Range.create(
          bounds.line,
          bounds.start + offset,
          bounds.line,
          bounds.start + offset,
        )
      }
    })

    this._lastCursorMoved = {
      mode,
      cursors: cursorPositions,
    }
    this._onCursorMoved.fire(this._lastCursorMoved)
  }

  // Helper method to query the value of the current placeholder,
  // propagate that to any other placeholders, and update the snippet
  public async synchronizeUpdatedPlaceholders(change: TextDocumentContentChangeEvent): Promise<void> {
    if (this.changedtick && this.document.changedtick - this.changedtick == 1) {
      return
    }
    let edit: TextEdit = {
      range: change.range,
      newText: change.text
    }
    if (!isLineEdit(edit)) {
      this._onCancelEvent.fire(void 0)
      return
    }

    // Get current cursor position
    const cursorPosition = await workspace.getCursorPosition()

    if (!this._currentPlaceholder) {
      return
    }

    const bounds = this._getBoundsForPlaceholder()

    if (cursorPosition.line !== bounds.line) {
      logger.info('Cursor outside snippet, cancelling snippet session')
      this._onCancelEvent.fire(void 0)
      return
    }

    // Check substring of placeholder start / placeholder finish
    let currentLine = this.document.getline(bounds.line)
    if (this.isEndLine) {
      currentLine = currentLine.slice(0, - this._suffix.length)
    }

    const startPosition = bounds.start
    const endPosition = currentLine.length - bounds.distanceFromEnd

    if (
      cursorPosition.character < startPosition ||
      cursorPosition.character > endPosition + 2
    ) {
      return
    }

    // Set placeholder value
    const newPlaceholderValue = currentLine.substring(startPosition, endPosition)
    await this.setPlaceholderValue(bounds.index, newPlaceholderValue)
  }

  private _finish(): void {
    this._onCancelEvent.fire(void 0)
  }

  private _getBoundsForPlaceholder(
    currentPlaceholder: CocSnippetPlaceholder = this._currentPlaceholder,
  ): {
      index: number
      line: number
      start: number
      length: number
      distanceFromEnd: number
    } {
    const currentSnippetLines = this._snippet.getLines()

    const start = currentPlaceholder.line === 0
        ? this._prefix.length + currentPlaceholder.character
        : currentPlaceholder.character
    const length = currentPlaceholder.value.length
    const distanceFromEnd =
      currentSnippetLines[currentPlaceholder.line].length -
      (currentPlaceholder.character + length)
    const line = currentPlaceholder.line + this._position.line

    return { index: currentPlaceholder.index, line, start, length, distanceFromEnd }
  }

  private async _updateSnippet(): Promise<void> {
    const snippetLines = this._snippet.getLines()
    const lastIndex = snippetLines.length - 1
    snippetLines[0] = this._prefix + snippetLines[0]
    snippetLines[lastIndex] = snippetLines[lastIndex] + this._suffix
    this._changedtick = this.document.changedtick
    await this.buffer.setLines(
      snippetLines, {
        start: this._position.line,
        end: this._position.line + snippetLines.length,
        strictIndexing: false
      }
    )
  }

  private async forceSync(): Promise<void> {
    let { dirty } = this.document
    if (dirty) {
      this.document.forceSync(true)
      await wait(30)
    }
  }

  private get isEndLine(): boolean {
    let currline = this._currentPlaceholder.line
    let len = this._snippet.getLines().length
    return currline == len - 1
  }

  private async selectPlaceholder(currentPlaceholder: CocSnippetPlaceholder): Promise<void> {
    if (!currentPlaceholder) {
      return
    }
    const adjustedLine = currentPlaceholder.line + this._position.line
    const adjustedCharacter = currentPlaceholder.line === 0
      ? this._position.character + currentPlaceholder.character
      : currentPlaceholder.character
    const len = currentPlaceholder.value.length
    const col = adjustedCharacter + 1

    if (currentPlaceholder.choice) {
      this.nvim.call('coc#snippet#show_choices', [adjustedLine + 1, col, len, currentPlaceholder.choice], true)
    } else {
      logger.debug('select:', len)
      this.nvim.call('coc#snippet#range_select', [adjustedLine + 1, col, len], true)
    }
  }
}
