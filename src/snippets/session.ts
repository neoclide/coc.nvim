import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, Range, TextDocumentContentChangeEvent, TextEdit, Position } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Document from '../model/document'
import { wait } from '../util'
import workspace from '../workspace'
import { CocSnippet, CocSnippetPlaceholder } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"
import { StatusBarItem } from '../types'
import { equals } from '../util/object'
const logger = require('../util/logger')('snippets-session')

export class SnippetSession {
  public document: Document
  private _isActive = false
  // Get state of line where we inserted
  private changedtick: number
  private snippet: CocSnippet = null
  // id of current placeholder
  private _currId = 0
  private statusItem: StatusBarItem

  constructor(private nvim: Neovim) {
    this.statusItem = workspace.createStatusBarItem(0)
    this.statusItem.text = 'SNIP'
  }

  public async start(snippetString: string): Promise<void> {
    let position = await workspace.getCursorPosition()
    let document = await workspace.document
    if (this.document && document != this.document) {
      this.finish()
    }
    let placeholder = this.currentPlaceholder
    this.document = document
    let formatOptions = await workspace.getFormatOptions(this.document.uri)
    const currentLine = document.getline(position.line)
    const currentIndent = currentLine.match(/^\s*/)[0]
    let inserted = normalizeSnippetString(snippetString, currentIndent, formatOptions)
    const snippet = new CocSnippet(
      inserted,
      position,
      new SnippetVariableResolver(position.line, Uri.parse(document.uri).fsPath))
    if (placeholder && !placeholder.isFinalTabstop && positionInRange(position, placeholder.range)) {
      logger.debug('connected')
      snippet.connect(placeholder)
    }
    const edit = TextEdit.insert(position, snippet.toString())
    await document.applyEdits(this.nvim, [edit])
    let firstPlaceholder = snippet.firstPlaceholder
    // make sure synchronize use old placeholder
    if (this.isActive) await wait(20)
    await this.selectPlaceholder(firstPlaceholder)
    if (firstPlaceholder.isFinalTabstop) {
      let { parentPlaceholder } = this
      if (parentPlaceholder) return
      this.snippet = parentPlaceholder.snippet
      this._currId = parentPlaceholder.id
    }
    this.active()
  }

  private active(): void {
    if (!this.isActive) {
      this._isActive = true
      this.nvim.call('coc#snippet#enable', [], true)
      this.statusItem.show()
    }
  }

  public async nextPlaceholder(): Promise<void> {
    if (!this.currentPlaceholder) return
    await this.forceSync()
    let placeholders = this.getSortedPlaceholders()
    let next: CocSnippetPlaceholder = null
    let range = this.currentPlaceholder.range
    for (let i = 0; i < placeholders.length; i++) {
      const p = placeholders[i]
      if (equals(p.range, range)) {
        next = placeholders[i + 1]
        break
      }
      if (comparePosition(p.range.start, range.start) > 0) {
        next = p
        break
      }
    }
    if (next) {
      await this.selectPlaceholder(next)
    } else {
      await this.selectPlaceholder(placeholders[0])
    }
  }

  public async previousPlaceholder(): Promise<void> {
    if (!this.currentPlaceholder) return
    await this.forceSync()
    let placeholders = this.getSortedPlaceholders()
    let prev: CocSnippetPlaceholder = null
    let range = this.currentPlaceholder.range
    for (let i = placeholders.length - 1; i >= 0; i--) {
      const p = placeholders[i]
      if (equals(p.range, range)) {
        prev = placeholders[i - 1]
        break
      }
      if (comparePosition(p.range.end, range.end) < 0) {
        prev = p
        break
      }
    }
    if (prev) {
      await this.selectPlaceholder(prev)
    } else {
      await this.selectPlaceholder(placeholders[placeholders.length - 1])
    }
  }

  public get uri(): string | null {
    if (!this.isActive) return null
    let { document } = this
    return document ? document.uri : null
  }

  // Update the cursor position relative to all placeholders
  public async onCursorMoved(): Promise<void> {
    // const pos = await workspace.getCursorPosition()
  }

  private findRootSnippet(): CocSnippet {
    let { snippet } = this
    while (true) {
      let p = snippet.getParent()
      if (!p) break
      snippet = p
    }
    return snippet
  }

  // Helper method to query the value of the current placeholder,
  // propagate that to any other placeholders, and update the snippet
  public async synchronizeUpdatedPlaceholders(change: TextDocumentContentChangeEvent): Promise<void> {
    if (this.changedtick && this.document.changedtick - this.changedtick == 1) return
    let edit: TextEdit = { range: change.range, newText: change.text }
    if (this.document.lastChange == 'insert') {
      // handle additionalTextEdits of auto import
      let line = edit.range.start.line
      let count = edit.newText.split("\n").length - 1
      this.each(snippet => {
        if (line < snippet.offset.line) {
          snippet.adjustPosition(0, count)
          return true
        }
        logger.info('Change outside snippet, cancelling snippet session')
        this.finish()
        return false
      })
      return
    }
    if (!this.currentPlaceholder
      || this.document.lastChange == 'delete'
      || edit.range.start.line != edit.range.end.line
      || edit.range.start.line != this.currentPlaceholder.line) {
      logger.info('Change outside snippet, cancelling snippet session')
      this.finish()
      return
    }
    let { start, end } = edit.range
    let { range, isFinalTabstop } = this.currentPlaceholder
    if (start.character < range.start.character || end.character > range.end.character) {
      if (this.parentPlaceholder) {
        logger.debug('break edit, disconnect:', edit, range)
        let { parentPlaceholder } = this
        // current snippet is broken
        this.snippet.disconnect()
        this._currId = parentPlaceholder.id
        this.snippet = parentPlaceholder.snippet
        await this.synchronizeUpdatedPlaceholders(change)
      } else {
        logger.info('Change outside current placeholder, cancelling snippet session')
        this.finish()
      }
      return
    }
    if (isFinalTabstop) {
      if (!this.parentPlaceholder) {
        logger.info('Change finalPlaceholder snippet, cancelling snippet session')
        this.finish()
        return
      }
      // change parent placeholder, it's always not finalstop
      let { parentPlaceholder } = this
      await this.applyEdit(parentPlaceholder, edit, true)
      return
    }
    await this.applyEdit(this.currentPlaceholder, edit, true)
  }

  private async selectPlaceholder(placeholder: CocSnippetPlaceholder): Promise<void> {
    if (!placeholder) return
    this._currId = placeholder.id
    this.snippet = placeholder.snippet
    let { start, end } = placeholder.range
    const len = end.character - start.character
    const col = start.character + 1
    if (placeholder.choice) {
      this.nvim.call('coc#snippet#show_choices', [start.line + 1, col, len, placeholder.choice], true)
    } else {
      this.nvim.call('coc#snippet#range_select', [start.line + 1, col, len], true)
    }
  }

  public finish(): void {
    if (!this.isActive) return
    let snippets = this.getSnippets()
    for (let snip of snippets) {
      snip.disconnect()
    }
    this._isActive = false
    this.snippet = null
    this._currId = 0
    this.statusItem.hide()
    this.nvim.call('coc#snippet#disable', [], true)
    logger.debug("[SnippetManager::cancel]")
  }

  public get isActive(): boolean {
    return this._isActive
  }

  private async forceSync(): Promise<void> {
    this.document.forceSync()
    await wait(40)
  }

  private each(callback: (snippet: CocSnippet) => boolean): void {
    let root = this.findRootSnippet()
    let fn = (s: CocSnippet): boolean => {
      let res = callback(s)
      if (res === false) return res
      for (let child of s.children) {
        let res = fn(child)
        if (res === false) return res
      }
      return true
    }
    fn(root)
  }

  private async applyEdit(placeholder: CocSnippetPlaceholder, edit: TextEdit, isChange = false): Promise<void> {
    let { snippet } = placeholder
    let { range } = snippet
    let edits = snippet.updatePlaceholder(placeholder, edit)
    if (edits === false) {
      this.finish()
      return
    }
    let snippets = this.getSnippets()
    if (isChange) this.adjustSnippets(snippets, edit)
    let snippetEdit: TextEdit = { range, newText: snippet.toString() }
    if (edits && edits.length) {
      this.changedtick = this.document.changedtick
      await this.document.applyEdits(this.nvim, edits)
      for (let edit of edits) {
        this.adjustSnippets(snippets, edit)
      }
    }
    if (snippet.parentPlaceholder) {
      // change parents
      await this.applyEdit(snippet.parentPlaceholder, snippetEdit)
    }
  }

  private adjustSnippets(snippets: CocSnippet[], edit: TextEdit): void {
    snippets = snippets.filter(s => {
      let { start } = s.range
      let { range } = edit
      return start.line == range.start.line && start.character > range.end.character
    })
    if (!snippets.length) return
    let { range } = edit
    let characterCount = edit.newText.length - (range.end.character - range.start.character)
    snippets.forEach(snip => {
      snip.adjustPosition(characterCount, 0)
    })
  }

  private get currentPlaceholder(): CocSnippetPlaceholder {
    if (!this.snippet) return null
    return this.snippet.getPlaceholderById(this._currId)
  }

  private get parentPlaceholder(): CocSnippetPlaceholder {
    if (!this.snippet) return null
    return this.snippet.parentPlaceholder
  }

  private getSortedPlaceholders(): CocSnippetPlaceholder[] {
    let res: CocSnippetPlaceholder[] = []
    this.each(snippet => {
      res.push(...snippet.getJumpPlaceholders())
      return true
    })
    res.sort((a, b) => comparePosition(a.range.start, b.range.start))
    res = res.filter(p => {
      if (p.isFinalTabstop && p.snippet.getParent() != null) return false
      return true
    })
    return res
  }

  private getSnippets(): CocSnippet[] {
    let res: Set<CocSnippet> = new Set()
    let root = this.findRootSnippet()
    let fn = (snippet: CocSnippet): void => {
      res.add(snippet)
      for (let child of snippet.children) {
        fn(child)
      }
    }
    fn(root)
    return Array.from(res)
  }
}

function comparePosition(position: Position, other: Position): number {
  if (other.line > position.line) return -1
  if (other.line == position.line && other.character > position.character) return -1
  return 1
}

function positionInRange(position: Position, range: Range): boolean {
  let { start, end } = range
  if (position.line < start.line || position.line > end.line) return false
  if (position.line == start.line && position.character < start.character) return false
  if (position.line == end.line && position.character > end.character) return false
  return true
}

function normalizeSnippetString(snippet: string, indent: string, opts: FormattingOptions): string {
  let lines = snippet.split(/\r?\n/)
  let ind = (new Array(opts.tabSize || 2)).fill(opts.insertSpaces ? ' ' : '\t').join('')
  lines = lines.map((line, idx) => {
    return (idx == 0 ? '' : indent) + line.split('\t').join(ind)
  })
  return lines.join('\n')
}
