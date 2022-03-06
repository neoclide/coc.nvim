import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions } from 'jsonc-parser'
import { Emitter, Event, InsertTextMode, Range, TextDocumentContentChangeEvent, TextEdit } from 'vscode-languageserver-protocol'
import completion from '../completion'
import events from '../events'
import Document from '../model/document'
import { UltiSnippetOption } from '../types'
import { comparePosition, isSingleLine, positionInRange, rangeInRange } from '../util/position'
import { byteLength, characterIndex } from '../util/string'
import { singleLineEdit } from '../util/textedit'
import window from '../window'
import workspace from '../workspace'
import { UltiSnippetContext } from './eval'
import { Marker, SnippetParser } from './parser'
import { CocSnippet, CocSnippetPlaceholder } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"
const logger = require('../util/logger')('snippets-session')

export class SnippetSession {
  private _isActive = false
  private current: Marker
  // Get state of line where we inserted
  private applying = false
  private preferComplete = false
  private _snippet: CocSnippet = null
  private _onCancelEvent = new Emitter<void>()
  public readonly onCancel: Event<void> = this._onCancelEvent.event

  constructor(private nvim: Neovim, public readonly bufnr: number) {
    let suggest = workspace.getConfiguration('suggest')
    this.preferComplete = suggest.get('preferCompleteThanJumpPlaceholder', false)
  }

  public async start(snippetString: string, select = true, range?: Range, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption): Promise<boolean> {
    const { document } = this
    if (!document || !document.attached) return false
    if (!range) {
      let position = await window.getCursorPosition()
      range = Range.create(position, position)
    }
    if (!this.isActive && SnippetParser.isPlainText(snippetString)) {
      let text = snippetString.replace(/\$0$/, '')
      let edits = [TextEdit.replace(range, text)]
      await document.applyEdits(edits)
      let lines = text.split(/\r?\n/)
      let len = lines.length
      let pos = {
        line: range.start.line + len - 1,
        character: len == 1 ? range.start.character + text.length : lines[len - 1].length
      }
      await window.moveTo(pos)
      this.deactivate()
      return false
    }
    void events.fire('InsertSnippet', [])
    let position = range.start
    await document.patchChange()
    const currentLine = document.getline(position.line)
    const currentIndent = currentLine.match(/^\s*/)[0]
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs) {
      inserted = snippetString
    } else {
      const formatOptions = await workspace.getFormatOptions(this.document.uri)
      inserted = normalizeSnippetString(snippetString, currentIndent, formatOptions)
    }
    const resolver = new SnippetVariableResolver(this.nvim)
    let context: UltiSnippetContext
    if (ultisnip) context = Object.assign({ range, line: currentLine }, ultisnip)
    const placeholder = this.getReplacePlaceholder(range)
    let snippet = this.snippet
    const edits: TextEdit[] = []
    if (placeholder) {
      // update all snippet.
      let r = snippet.range
      this.current = await this.snippet.insertSnippet(placeholder, inserted, range, context)
      edits.push(TextEdit.replace(r, snippet.toString()))
    } else {
      snippet = new CocSnippet(inserted, position, this.nvim, resolver)
      await snippet.init(context)
      this.current = snippet.firstPlaceholder?.marker
      edits.push(TextEdit.replace(range, snippet.toString()))
      // try fix indent of remain text
      if (snippetString.endsWith('\n')) {
        const remain = currentLine.slice(range.end.character)
        if (remain.length) {
          let s = range.end.character
          let l = remain.match(/^\s*/)[0].length
          let r = Range.create(range.end.line, s, range.end.line, s + l)
          edits.push(TextEdit.replace(r, currentIndent))
        }
      }
    }
    this.applying = true
    await document.applyEdits(edits)
    this.applying = false
    this._snippet = snippet
    if (select) await this.selectCurrentPlaceholder()
    this.activate()
    return true
  }

  /**
   * Get valid placeholder to insert
   */
  private getReplacePlaceholder(range: Range): CocSnippetPlaceholder | undefined {
    if (!this._isActive) return undefined
    let placeholder = this.findPlaceholder(range)
    if (!placeholder || placeholder.index == 0) return undefined
    return placeholder
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
      this.current = null
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
    if (next) await this.selectPlaceholder(next)
  }

  public async previousPlaceholder(): Promise<void> {
    if (!this.isActive) return
    await this.document.patchChange()
    let curr = this.placeholder
    let prev = this.snippet.getPrevPlaceholder(curr.index)
    if (prev) await this.selectPlaceholder(prev)
  }

  public async synchronizeUpdatedPlaceholders(change: TextDocumentContentChangeEvent, changedLine?: string): Promise<void> {
    if (!this.isActive || !this.document || this.applying) return
    let edit: TextEdit = { range: (change as any).range, newText: change.text }
    let { snippet } = this
    // change outside range
    let adjusted = snippet.adjustTextEdit(edit, changedLine)
    if (adjusted) return
    let currRange = this.placeholder.range
    if (changedLine != null
      && edit.range.start.line == currRange.start.line
      && singleLineEdit(edit)
      && !rangeInRange(edit.range, currRange)
      && isSingleLine(currRange)
      && changedLine.slice(currRange.start.character, currRange.end.character) == this.placeholder.value
      && events.cursor
      && events.cursor.bufnr == this.bufnr
      && events.cursor.lnum == edit.range.start.line + 1) {
      let col = events.cursor.col
      // split changedLine with currRange
      let preText = changedLine.slice(0, currRange.start.character)
      let postText = changedLine.slice(currRange.end.character)
      let newLine = this.document.getline(edit.range.start.line)
      if (newLine.startsWith(preText) && newLine.endsWith(postText)) {
        let endCharacter = newLine.length - postText.length
        let cursorIdx = characterIndex(newLine, col - 1)
        // make sure cursor in range
        if (cursorIdx >= preText.length && cursorIdx <= endCharacter) {
          let newText = newLine.slice(preText.length, endCharacter)
          edit = TextEdit.replace(currRange, newText)
        }
      }
    }
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
    if (placeholder.index == 0 && snippet.finalCount <= 1) {
      logger.info('Change final placeholder, cancelling snippet session')
      this.deactivate()
      return
    }
    this.current = placeholder.marker
    let { edits, delta } = await snippet.updatePlaceholder(placeholder, edit)
    if (!edits.length) return
    this.applying = true
    await this.document.applyEdits(edits)
    this.applying = false
    if (delta) {
      await this.nvim.call('coc#cursor#move_by_col', delta)
    }
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    if (!this.snippet) return
    let placeholder = this.snippet.getPlaceholderByMarker(this.current)
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    let { start, end } = placeholder.range
    const len = end.character - start.character
    const col = byteLength(document.getline(start.line).slice(0, start.character)) + 1
    this.current = placeholder.marker
    if (placeholder.choice) {
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, len, placeholder.choice])
      if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    } else {
      await this.select(placeholder, triggerAutocmd)
    }
  }

  private async select(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { range, value } = placeholder
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
    if (pumvisible) {
      nvim.call('coc#_cancel', [], true)
    }
    nvim.setOption('virtualedit', ve, true)
    if (placeholder.index == 0) {
      if (this.snippet.finalCount == 1) {
        logger.info('Jump to final placeholder, cancelling snippet session')
        this.deactivate()
      } else {
        nvim.call('coc#snippet#disable', [], true)
      }
    }
    await nvim.resumeNotification(true)
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
    return this.snippet.getPlaceholderByMarker(this.current)
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
