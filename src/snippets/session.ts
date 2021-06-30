import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions } from 'jsonc-parser'
import { Emitter, Event, InsertTextMode, Range, TextDocumentContentChangeEvent, TextEdit } from 'vscode-languageserver-protocol'
import completion from '../completion'
import Document from '../model/document'
import { comparePosition, positionInRange, rangeInRange } from '../util/position'
import { byteLength } from '../util/string'
import workspace from '../workspace'
import window from '../window'
import events from '../events'
import { CocSnippet, CocSnippetPlaceholder } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"
const logger = require('../util/logger')('snippets-session')

export class SnippetSession {
  private _isActive = false
  private _currId = 0
  // Get state of line where we inserted
  private applying = false
  private preferComplete = false
  private _snippet: CocSnippet = null
  private _onCancelEvent = new Emitter<void>()
  public readonly onCancel: Event<void> = this._onCancelEvent.event

  constructor(private nvim: Neovim, public readonly bufnr: number) {
    let config = workspace.getConfiguration('coc.preferences')
    let suggest = workspace.getConfiguration('suggest')
    this.preferComplete = config.get<boolean>('preferCompleteThanJumpPlaceholder', suggest.get('preferCompleteThanJumpPlaceholder', false))
  }

  public async start(snippetString: string, select = true, range?: Range, insertTextMode?: InsertTextMode): Promise<boolean> {
    const { document } = this
    if (!document || !document.attached) return false
    events.fire('InsertSnippet', []).logError()
    if (!range) {
      let position = await window.getCursorPosition()
      range = Range.create(position, position)
    }
    let position = range.start
    const formatOptions = await workspace.getFormatOptions(this.document.uri)
    await document.patchChange(true)
    const currentLine = document.getline(position.line)
    const currentIndent = currentLine.match(/^\s*/)[0]
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs) {
      inserted = snippetString
    } else {
      inserted = normalizeSnippetString(snippetString, currentIndent, formatOptions)
    }
    const resolver = new SnippetVariableResolver()
    const snippet = new CocSnippet(inserted, position, resolver)
    await snippet.init()
    const edit = TextEdit.replace(range, snippet.toString())
    if (snippetString.endsWith('\n')
      && currentLine.slice(position.character).length) {
      // make next line same indent
      edit.newText = edit.newText + currentIndent
      inserted = inserted + currentIndent
    }
    this.applying = true
    await document.applyEdits([edit])
    this.applying = false
    if (this._isActive) {
      // find valid placeholder
      let placeholder = this.findPlaceholder(range)
      // insert to placeholder
      if (placeholder && !placeholder.isFinalTabstop) {
        // don't repeat snippet insert
        let index = this.snippet.insertSnippet(placeholder, inserted, range)
        let p = this.snippet.getPlaceholder(index)
        this._currId = p.id
        if (select) await this.selectPlaceholder(p)
        return true
      }
    }
    if (snippet.isPlainText) {
      this.deactivate()
      let placeholder = snippet.finalPlaceholder
      await window.moveTo(placeholder.range.start)
      return false
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
    if (this._isActive) {
      this._isActive = false
      this._snippet = null
      this.nvim.call('coc#snippet#disable', [], true)
      logger.debug("[SnippetManager::cancel]")
    }
    this._onCancelEvent.fire(void 0)
    this._onCancelEvent.dispose()
  }

  public get isActive(): boolean {
    return this._isActive
  }

  public async nextPlaceholder(): Promise<void> {
    if (!this.isActive) return
    await this.document.patchChange()
    let curr = this.placeholder
    let next = this.snippet.getNextPlaceholder(curr.index)
    await this.selectPlaceholder(next)
  }

  public async previousPlaceholder(): Promise<void> {
    if (!this.isActive) return
    await this.document.patchChange()
    let curr = this.placeholder
    let prev = this.snippet.getPrevPlaceholder(curr.index)
    await this.selectPlaceholder(prev)
  }

  public async synchronizeUpdatedPlaceholders(change: TextDocumentContentChangeEvent): Promise<void> {
    if (!this.isActive || !this.document || this.applying) return
    let edit: TextEdit = { range: (change as any).range, newText: change.text }
    let { snippet } = this
    // change outside range
    let adjusted = snippet.adjustTextEdit(edit)
    if (adjusted) return
    if (comparePosition(edit.range.start, snippet.range.end) > 0) {
      if (!edit.newText) return
      logger.info('Content change after snippet, cancelling snippet session')
      this.deactivate()
      return
    }
    let placeholder = this.findPlaceholder(edit.range)
    if (!placeholder) {
      logger.info('Change outside placeholder, cancelling snippet session')
      this.deactivate()
      return
    }
    if (placeholder.isFinalTabstop && snippet.finalCount <= 1) {
      logger.info('Change final placeholder, cancelling snippet session')
      this.deactivate()
      return
    }
    this._currId = placeholder.id
    let { edits, delta } = snippet.updatePlaceholder(placeholder, edit)
    if (!edits.length) return
    this.applying = true
    await this.document.applyEdits(edits)
    this.applying = false
    if (delta) {
      await this.nvim.call('coc#util#move_cursor', delta)
    }
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    let placeholder = this.snippet.getPlaceholderById(this._currId)
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    let { start, end } = placeholder.range
    const len = end.character - start.character
    const col = byteLength(document.getline(start.line).slice(0, start.character)) + 1
    this._currId = placeholder.id
    if (placeholder.choice) {
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, len, placeholder.choice])
      if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    } else {
      await this.select(placeholder, triggerAutocmd)
    }
  }

  private async select(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { range, value, isFinalTabstop } = placeholder
    let { document, nvim } = this
    let { start, end } = range
    let { textDocument } = document
    let len = textDocument.offsetAt(end) - textDocument.offsetAt(start)
    let line = document.getline(start.line)
    let col = line ? byteLength(line.slice(0, start.character)) : 0
    let endLine = document.getline(end.line)
    let endCol = endLine ? byteLength(endLine.slice(0, end.character)) : 0
    nvim.setVar('coc_last_placeholder', {
      bufnr: document.bufnr,
      current_text: value,
      start: { line: start.line, col, character: start.character },
      end: { line: end.line, col: endCol, character: end.character }
    }, true)
    let [ve, selection, pumvisible, mode] = await nvim.eval('[&virtualedit, &selection, pumvisible(), mode()]') as [string, string, number, string]
    let move_cmd = ''
    if (pumvisible && this.preferComplete) {
      let pre = completion.hasSelected() ? '' : '\\<C-n>'
      await nvim.eval(`feedkeys("${pre}\\<C-y>", 'in')`)
      return
    }
    // create move cmd
    if (mode != 'n') move_cmd += "\\<Esc>"
    if (len == 0) {
      if (col == 0 || (!mode.startsWith('i') && col < byteLength(line))) {
        move_cmd += 'i'
      } else {
        move_cmd += 'a'
      }
    } else {
      move_cmd += 'v'
      endCol = await this.getVirtualCol(end.line + 1, endCol)
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
      col = await this.getVirtualCol(start.line + 1, col)
      move_cmd += `o${start.line + 1}G${col + 1}|o\\<c-g>`
    }
    if (mode == 'i' && move_cmd == "\\<Esc>a") {
      move_cmd = ''
    }
    nvim.pauseNotification()
    nvim.setOption('virtualedit', 'onemore', true)
    nvim.call('cursor', [start.line + 1, col + (move_cmd == 'a' ? 0 : 1)], true)
    if (move_cmd) {
      nvim.call('eval', [`feedkeys("${move_cmd}", 'in')`], true)
    }
    if (mode == 'i') {
      nvim.call('coc#_cancel', [], true)
    }
    nvim.setOption('virtualedit', ve, true)
    if (isFinalTabstop) {
      if (this.snippet.finalCount == 1) {
        logger.info('Jump to final placeholder, cancelling snippet session')
        this.deactivate()
      } else {
        nvim.call('coc#snippet#disable', [], true)
      }
    }
    if (workspace.env.isVim) nvim.command('redraw', true)
    await nvim.resumeNotification()
    if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
  }

  private async getVirtualCol(line: number, col: number): Promise<number> {
    let { nvim } = this
    return await nvim.eval(`virtcol([${line}, ${col}])`) as number
  }

  public async checkPosition(): Promise<void> {
    if (!this.isActive) return
    let position = await window.getCursorPosition()
    if (this.snippet && positionInRange(position, this.snippet.range) != 0) {
      logger.info('Cursor insert out of range, cancelling snippet session')
      this.deactivate()
    }
  }

  public findPlaceholder(range: Range): CocSnippetPlaceholder | null {
    if (!this.snippet) return null
    let { placeholder } = this
    if (placeholder && rangeInRange(range, placeholder.range)) return placeholder
    return this.snippet.getPlaceholderByRange(range) || null
  }

  public get placeholder(): CocSnippetPlaceholder {
    if (!this.snippet) return null
    return this.snippet.getPlaceholderById(this._currId)
  }

  public get snippet(): CocSnippet {
    return this._snippet
  }

  private get document(): Document {
    return workspace.getDocument(this.bufnr)
  }
}

export function normalizeSnippetString(snippet: string, indent: string, opts: FormattingOptions): string {
  let lines = snippet.split(/\r?\n/)
  let ind = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
  let tabSize = opts.tabSize || 2
  lines = lines.map((line, idx) => {
    let space = line.match(/^\s*/)[0]
    let pre = space
    let isTab = space.startsWith('\t')
    if (isTab && opts.insertSpaces) {
      pre = ind.repeat(space.length)
    } else if (!isTab && !opts.insertSpaces) {
      pre = ind.repeat(space.length / tabSize)
    }
    return (idx == 0 || line.length == 0 ? '' : indent) + pre + line.slice(space.length)
  })
  return lines.join('\n')
}
