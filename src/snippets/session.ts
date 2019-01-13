import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions } from 'jsonc-parser'
import { Emitter, Event, Position, Range, TextDocumentContentChangeEvent, TextEdit } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { wait } from '../util'
import { comparePosition, positionInRange } from '../util/position'
import { byteLength } from '../util/string'
import workspace from '../workspace'
import { CocSnippet, CocSnippetPlaceholder } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"
const logger = require('../util/logger')('snippets-session')

export class SnippetSession {
  private _isActive = false
  private _currId = 0
  // Get state of line where we inserted
  private version: number
  private preferComplete = false
  private _snippet: CocSnippet = null
  private _onCancelEvent = new Emitter<void>()
  public readonly onCancel: Event<void> = this._onCancelEvent.event

  constructor(private nvim: Neovim, public readonly bufnr: number) {
    let config = workspace.getConfiguration('coc.preferences')
    this.preferComplete = config.get<boolean>('preferCompleteThanJumpPlaceholder', false)
  }

  public async start(snippetString: string, select = true, position?: Position): Promise<boolean> {
    const { document, nvim } = this
    if (!document) return false
    if (!position) position = await workspace.getCursorPosition()
    const formatOptions = await workspace.getFormatOptions(this.document.uri)
    const currentLine = document.getline(position.line)
    const currentIndent = currentLine.match(/^\s*/)[0]
    const inserted = normalizeSnippetString(snippetString, currentIndent, formatOptions)
    const resolver = new SnippetVariableResolver()
    await resolver.init(document)
    const snippet = new CocSnippet(inserted, position, resolver)
    const edit = TextEdit.insert(position, snippet.toString())
    const endPart = currentLine.slice(position.character)
    if (snippetString.endsWith('\n') && endPart) {
      // make next line same indent
      edit.newText = edit.newText + currentIndent
    }
    if (snippet.isPlainText) {
      // insert as text
      await document.applyEdits(nvim, [edit])
      let placeholder = snippet.finalPlaceholder
      await workspace.moveTo(placeholder.range.start)
      return this._isActive
    }
    this.version = document.version
    await document.applyEdits(nvim, [edit])
    if (this._isActive) {
      // insert check
      let placeholder = this.findPlaceholder(Range.create(position, position))
      // insert to placeholder
      if (placeholder && !placeholder.isFinalTabstop) {
        // don't repeat snippet insert
        let index = this.snippet.insertSnippet(placeholder, inserted, position)
        let p = this.snippet.getPlaceholder(index)
        this._currId = p.id
        if (select) await this.selectPlaceholder(p)
        return true
      }
    }
    // new snippet
    this._snippet = snippet
    this._currId = snippet.firstPlaceholder.id
    if (select) await this.selectPlaceholder(snippet.firstPlaceholder)
    this.activate()
    return true
  }

  private activate(): void {
    if (this._isActive) return
    this._isActive = true
    this.nvim.call('coc#snippet#enable', [], true)
  }

  public deactivate(): void {
    if (!this._isActive) return
    this._isActive = false
    this._snippet = null
    this.nvim.call('coc#snippet#disable', [], true)
    logger.debug("[SnippetManager::cancel]")
    this._onCancelEvent.fire(void 0)
    this._onCancelEvent.dispose()
  }

  public get isActive(): boolean {
    return this._isActive
  }

  public async nextPlaceholder(): Promise<void> {
    await this.documentSynchronize()
    if (!this.isActive) return
    let curr = this.placeholder
    let next = this.snippet.getNextPlaceholder(curr.index)
    await this.selectPlaceholder(next)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.documentSynchronize()
    if (!this.isActive) return
    let curr = this.placeholder
    let prev = this.snippet.getPrevPlaceholder(curr.index)
    await this.selectPlaceholder(prev)
  }

  public async synchronizeUpdatedPlaceholders(change: TextDocumentContentChangeEvent): Promise<void> {
    if (!this.isActive || !this.document) return
    if (this.version && this.document.version - this.version == 1) return
    let edit: TextEdit = { range: change.range, newText: change.text }
    let { snippet } = this
    // change outside range
    let adjusted = snippet.adjustTextEdit(edit)
    if (adjusted) return
    if (comparePosition(edit.range.start, snippet.range.end) > 0) {
      if (!edit.newText) return
      logger.info('Content add after snippet, cancelling snippet session')
      this.deactivate()
      return
    }
    let placeholder = this.findPlaceholder(edit.range)
    if (!placeholder) {
      logger.info('Change outside placeholder, cancelling snippet session')
      this.deactivate()
      return
    }
    if (placeholder.isFinalTabstop) {
      logger.info('Change final placeholder, cancelling snippet session')
      this.deactivate()
      return
    }
    this._currId = placeholder.id
    let edits = snippet.updatePlaceholder(placeholder, edit)
    if (!edits.length) return
    this.version = this.document.version
    await this.document.applyEdits(this.nvim, edits)
  }

  public async selectCurrentPlaceholder(): Promise<void> {
    let placeholder = this.snippet.getPlaceholderById(this._currId)
    if (placeholder) await this.selectPlaceholder(placeholder)
    if (workspace.env.isMacvim) {
      setTimeout(() => {
        this.nvim.call('feedkeys', [String.fromCharCode(27), 'in'], true)
      }, 30)
    }
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    await document.patchChange()
    let { start, end } = placeholder.range
    const len = end.character - start.character
    const col = byteLength(document.getline(start.line).slice(0, start.character)) + 1
    this._currId = placeholder.id
    if (placeholder.choice) {
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, len, placeholder.choice])
    } else {
      await this.select(placeholder.range)
    }
  }

  private async select(range: Range): Promise<void> {
    let { document, nvim } = this
    let { start, end } = range
    let { textDocument } = document
    let len = textDocument.offsetAt(end) - textDocument.offsetAt(start)
    let line = document.getline(start.line)
    let endLine = document.getline(end.line)
    let endCol = endLine ? byteLength(endLine.slice(0, end.character)) : 0
    let col = line ? byteLength(line.slice(0, start.character)) : 0
    let ve = await nvim.getOption('virtualedit')
    let selection = await nvim.getOption('selection')
    let mode = await nvim.call('mode') as string
    let move_cmd = ''
    if (mode.startsWith('i')) {
      let pum = await nvim.call('pumvisible')
      if (pum && this.preferComplete) {
        await nvim.eval(`feedkeys("\\<C-y>", 'in')`)
        return
      }
    }
    let resetVirtualEdit = false
    if (ve != 'onemore') {
      resetVirtualEdit = true
      await nvim.setOption('virtualedit', 'onemore')
    }
    await nvim.call('cursor', [start.line + 1, col + 1])
    if (mode != 'n') move_cmd += "\\<Esc>"
    if (len == 0) {
      if (col == 0 || (!mode.startsWith('i') && col < byteLength(line))) {
        move_cmd += 'i'
      } else {
        move_cmd += 'a'
      }
    } else {
      move_cmd += 'v'
      if (selection == 'inclusive') {
        if (end.character == 0) {
          move_cmd += `${end.line}G`
        } else {
          move_cmd += `${end.line + 1}G${endCol}|`
        }
      } else if (selection == 'old') {
        move_cmd += `${end.line + 1}G${endCol}|`
      } else {
        move_cmd += `${end.line + 1}G${endCol + 1}|`
      }
      move_cmd += `o${start.line + 1}G${col + 1}|o\\<c-g>`
    }
    logger.debug('move:', move_cmd)
    await nvim.eval(`feedkeys("${move_cmd}", 'in')`)
    if (resetVirtualEdit) await nvim.setOption('virtualedit', ve)
  }

  private async documentSynchronize(): Promise<void> {
    if (!this.isActive) return
    await this.document.patchChange()
    if (this.document.dirty) {
      this.document.forceSync()
      await wait(40)
    }
  }

  public async checkPosition(): Promise<void> {
    if (!this.isActive) return
    let position = await workspace.getCursorPosition()
    if (this.snippet && positionInRange(position, this.snippet.range) != 0) {
      logger.info('Cursor insert out of range, cancelling snippet session')
      this.deactivate()
    }
  }

  public findPlaceholder(range: Range): CocSnippetPlaceholder | null {
    if (!this.snippet) return null
    return this.snippet.getPlaceholderByRange(range) || null
  }

  public get placeholder(): CocSnippetPlaceholder {
    if (!this.snippet) return
    return this.snippet.getPlaceholderById(this._currId)
  }

  public get snippet(): CocSnippet {
    return this._snippet
  }

  private get document(): Document {
    return workspace.getDocument(this.bufnr)
  }
}

function normalizeSnippetString(snippet: string, indent: string, opts: FormattingOptions): string {
  let lines = snippet.split(/\r?\n/)
  let ind = (new Array(opts.tabSize || 2)).fill(opts.insertSpaces ? ' ' : '\t').join('')
  lines = lines.map((line, idx) => {
    return (idx == 0 || line.length == 0 ? '' : indent) + line.split('\t').join(ind)
  })
  return lines.join('\n')
}
