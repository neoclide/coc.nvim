'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import events from '../events'
import BufferSync from '../model/bufferSync'
import { StatusBarItem } from '../model/status'
import { UltiSnippetOption } from '../types'
import { defaultValue, disposeAll } from '../util'
import { deepClone } from '../util/object'
import { emptyRange, toValidRange } from '../util/position'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode, generateContextId, getInitialPythonCode, hasPython } from './eval'
import { SnippetConfig, SnippetEdit, SnippetSession } from './session'
import { SnippetString } from './string'
import { getAction, normalizeSnippetString, shouldFormat, SnippetFormatOptions, toSnippetString, UltiSnippetContext } from './util'

export class SnippetManager {
  private disposables: Disposable[] = []
  private _statusItem: StatusBarItem
  private bufferSync: BufferSync<SnippetSession>
  private config: SnippetConfig

  public init() {
    this.synchronizeConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('snippet') || e.affectsConfiguration('suggest')) {
        this.synchronizeConfig()
      }
    }, null, this.disposables)
    events.on(['InsertCharPre', 'Enter'], () => {
      let session = this.session
      if (session) session.cancel()
    }, null, this.disposables)
    events.on('CompleteDone', async (_item, _line, bufnr) => {
      let session = this.bufferSync.getItem(bufnr)
      if (session) await session.onCompleteDone()
    }, null, this.disposables)
    events.on('CompleteStart', async opt => {
      let session = this.bufferSync.getItem(opt.bufnr)
      if (session) session.cancel(true)
    }, null, this.disposables)
    events.on('InsertEnter', async bufnr => {
      let session = this.bufferSync.getItem(bufnr)
      if (session) await session.checkPosition()
    }, null, this.disposables)

    this.bufferSync = workspace.registerBufferSync(doc => {
      let session = new SnippetSession(this.nvim, doc, this.config)
      session.onActiveChange(isActive => {
        if (events.bufnr !== session.bufnr) return
        this.statusItem[isActive ? 'show' : 'hide']()
      })
      return session
    })
    this.disposables.push(this.bufferSync)

    window.onDidChangeActiveTextEditor(async e => {
      let session = this.bufferSync.getItem(e.bufnr)
      if (session && session.isActive) {
        this.statusItem.show()
        if (!session.selected) {
          await session.selectCurrentPlaceholder()
        }
      } else {
        this.statusItem.hide()
      }
    }, null, this.disposables)

    commands.register({
      id: 'editor.action.insertSnippet',
      execute: async (edit: TextEdit, ultisnip?: UltiSnippetOption | true) => {
        const opts = ultisnip === true ? {} : ultisnip
        return await this.insertSnippet(edit.newText, true, edit.range, InsertTextMode.adjustIndentation, opts ? opts : undefined)
      }
    }, true)
    commands.register({
      id: 'editor.action.insertBufferSnippets',
      execute: async (bufnr: number, edits: SnippetEdit[], select: boolean) => {
        return await this.insertBufferSnippets(bufnr, edits, select)
      }
    }, true)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private get statusItem(): StatusBarItem {
    if (this._statusItem) return this._statusItem
    const snippetConfig = workspace.initialConfiguration.get('snippet') as any
    const statusItem = this._statusItem = window.createStatusBarItem(0)
    statusItem.text = defaultValue(snippetConfig.statusText, '')
    return this._statusItem
  }

  private synchronizeConfig(): void {
    const snippetConfig = workspace.getConfiguration('snippet', null)
    const suggest = workspace.getConfiguration('suggest', null)
    let obj = {
      highlight: defaultValue(snippetConfig.inspect('highlight').globalValue, false) as boolean,
      nextOnDelete: defaultValue(snippetConfig.inspect('nextPlaceholderOnDelete').globalValue, false) as boolean,
      preferComplete: suggest.get<boolean>('preferCompleteThanJumpPlaceholder', false)
    }
    if (this.config) {
      Object.assign(this.config, obj)
    } else {
      this.config = obj
    }
  }

  private async toRange(range: Range | undefined): Promise<Range> {
    if (range) return toValidRange(range)
    let pos = await window.getCursorPosition()
    return Range.create(pos, pos)
  }

  public async insertBufferSnippets(bufnr: number, edits: SnippetEdit[], select = false): Promise<boolean> {
    let document = workspace.getAttachedDocument(bufnr)
    const session = this.bufferSync.getItem(bufnr)
    session.cancel(true)
    let snippetEdit: SnippetEdit[] = []
    for (const edit of edits) {
      let currentLine = document.getline(edit.range.start.line)
      let inserted = await this.normalizeInsertText(bufnr, toSnippetString(edit.snippet), currentLine, InsertTextMode.asIs)
      snippetEdit.push({ range: edit.range, snippet: inserted })
    }
    await session.synchronize()
    let isActive = await session.insertSnippetEdits(edits)
    if (isActive && select && workspace.bufnr === bufnr) {
      await session.selectCurrentPlaceholder()
    }
    return isActive
  }

  /**
   * Insert snippet to specific buffer, ultisnips not supported, and the placeholder is not selected
   */
  public async insertBufferSnippet(bufnr: number, snippet: string | SnippetString, range: Range, insertTextMode?: InsertTextMode): Promise<boolean> {
    let document = workspace.getAttachedDocument(bufnr)
    const session = this.bufferSync.getItem(bufnr)
    session.cancel(true)
    range = toValidRange(range)
    const line = document.getline(range.start.line)
    const snippetStr = toSnippetString(snippet)
    const inserted = await this.normalizeInsertText(document.bufnr, snippetStr, line, insertTextMode)
    await session.synchronize()
    return await session.start(inserted, range, false)
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string | SnippetString, select = true, range?: Range, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption): Promise<boolean> {
    let { nvim } = workspace
    let document = workspace.getAttachedDocument(workspace.bufnr)
    const session = this.bufferSync.getItem(document.bufnr)
    let context: UltiSnippetContext
    session.cancel(true)
    range = await this.toRange(range)
    const currentLine = document.getline(range.start.line)
    const snippetStr = toSnippetString(snippet)
    const inserted = await this.normalizeInsertText(document.bufnr, snippetStr, currentLine, insertTextMode, ultisnip)
    if (ultisnip != null) {
      const usePy = hasPython(ultisnip) || inserted.includes('`!p')
      const bufnr = document.bufnr
      context = Object.assign({ range: deepClone(range), line: currentLine }, ultisnip, { id: generateContextId(bufnr) })
      if (usePy) {
        if (session.placeholder) {
          let { start, end } = session.placeholder.range
          let last = {
            current_text: session.placeholder.value,
            start: { line: start.line, col: start.character },
            end: { line: end.line, col: end.character }
          }
          this.nvim.setVar('coc_last_placeholder', last, true)
        } else {
          this.nvim.call('coc#compat#del_var', ['coc_last_placeholder'], true)
        }
        const codes = getInitialPythonCode(context)
        let preExpand = getAction(ultisnip, 'preExpand')
        if (preExpand) {
          nvim.call('coc#cursor#move_to', [range.end.line, range.end.character], true)
          await executePythonCode(nvim, codes.concat(['snip = coc_ultisnips_dict["PreExpandContext"]()', preExpand]))
          const [valid, pos] = await nvim.call('pyxeval', 'snip.getResult()') as [boolean, [number, number]]
          // need remove the trigger
          if (valid) {
            let count = range.end.character - range.start.character
            range = Range.create(pos[0], Math.max(0, pos[1] - count), pos[0], pos[1])
          } else {
            // trigger removed already
            range = Range.create(pos[0], pos[1], pos[0], pos[1])
          }
        } else {
          await executePythonCode(nvim, codes)
        }
      }
    }
    // same behavior as Ultisnips
    const noMove = ultisnip == null && !session.isActive
    if (!noMove) {
      const { start } = range
      nvim.call('coc#cursor#move_to', [start.line, start.character], true)
      // range could outside snippet range when session synchronize is canceled
      if (!emptyRange(range)) {
        await document.applyEdits([TextEdit.del(range)])
      }
      if (session.isActive) {
        await session.synchronize()
        // the cursor position could be changed on session synchronize.
        let pos = await window.getCursorPosition()
        range = Range.create(pos, pos)
      } else {
        range.end = Position.create(start.line, start.character)
      }
    }
    await session.start(inserted, range, select, context)
    return session.isActive
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    let { session } = this
    if (session) return await session.selectCurrentPlaceholder(triggerAutocmd)
  }

  public async nextPlaceholder(): Promise<string> {
    let { session } = this
    if (session) {
      await session.nextPlaceholder()
    } else {
      this.nvim.call('coc#snippet#disable', [], true)
    }
    return ''
  }

  public async previousPlaceholder(): Promise<string> {
    let { session } = this
    if (session) {
      await session.previousPlaceholder()
    } else {
      this.nvim.call('coc#snippet#disable', [], true)
    }
    return ''
  }

  public cancel(): void {
    let session = this.bufferSync.getItem(workspace.bufnr)
    if (session) return session.deactivate()
    this.nvim.call('coc#snippet#disable', [], true)
    this.statusItem.hide()
  }

  public get session(): SnippetSession | undefined {
    return this.bufferSync.getItem(workspace.bufnr)
  }

  /**
   * exported method
   */
  public getSession(bufnr: number): SnippetSession | undefined {
    let session = this.bufferSync.getItem(bufnr)
    return session && session.isActive ? session : undefined
  }

  public isActivated(bufnr: number): boolean {
    let session = this.bufferSync.getItem(bufnr)
    return session && session.isActive
  }

  public jumpable(): boolean {
    let { session } = this
    if (!session) return false
    return session.placeholder != null && session.placeholder.index != 0
  }

  /**
   * Exposed for snippet preview
   */
  public async resolveSnippet(snippetString: string, ultisnip?: UltiSnippetOption): Promise<string | undefined> {
    let session = this.bufferSync.getItem(workspace.bufnr)
    if (!session) return
    return await session.resolveSnippet(this.nvim, snippetString, ultisnip)
  }

  public async normalizeInsertText(bufnr: number, snippetString: string, currentLine: string, insertTextMode: InsertTextMode, ultisnip?: Partial<UltiSnippetOption>): Promise<string> {
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs || !shouldFormat(snippetString)) {
      inserted = snippetString
    } else {
      const currentIndent = currentLine.match(/^\s*/)[0]
      let formatOptions = await workspace.getFormatOptions(bufnr) as SnippetFormatOptions
      let opts: Partial<UltiSnippetOption> = ultisnip ?? {}
      // trim when option not exists
      formatOptions.trimTrailingWhitespace = opts.trimTrailingWhitespace !== false
      if (opts.noExpand) formatOptions.noExpand = true
      inserted = normalizeSnippetString(snippetString, currentIndent, formatOptions)
    }
    return inserted
  }

  public dispose(): void {
    this.cancel()
    disposeAll(this.disposables)
  }
}

export default new SnippetManager()
