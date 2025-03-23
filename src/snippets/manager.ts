'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import events from '../events'
import BufferSync from '../model/bufferSync'
import { StatusBarItem } from '../model/status'
import { UltiSnippetOption } from '../types'
import { defaultValue, disposeAll } from '../util'
import { Mutex } from '../util/mutex'
import { deepClone } from '../util/object'
import { emptyRange, toValidRange } from '../util/position'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode, getInitialPythonCode, hasPython } from './eval'
import { SnippetConfig, SnippetSession } from './session'
import { SnippetString } from './string'
import { getAction, normalizeSnippetString, shouldFormat, SnippetFormatOptions, UltiSnippetContext } from './util'

export class SnippetManager {
  private disposables: Disposable[] = []
  private _statusItem: StatusBarItem
  private bufferSync: BufferSync<SnippetSession>
  private mutex: Mutex = new Mutex()
  private config: SnippetConfig

  public init() {
    this.synchronizeConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('snippet') || e.affectsConfiguration('suggest')) {
        this.synchronizeConfig()
      }
    })
    events.on('CompleteDone', async () => {
      let session = this.bufferSync.getItem(workspace.bufnr)
      if (session) await session.onCompleteDone()
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

    window.onDidChangeActiveTextEditor(e => {
      if (!this._statusItem) return
      let session = this.bufferSync.getItem(e.bufnr)
      if (session && session.isActive) {
        this.statusItem.show()
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
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private get statusItem(): StatusBarItem {
    if (this._statusItem) return this._statusItem
    let statusItem = this._statusItem = window.createStatusBarItem(0)
    const snippetConfig = workspace.initialConfiguration.get('snippet') as any
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

  /**
   * Insert snippet to specific buffer, ultisnips not supported, and the placeholder is not selected
   */
  public async insertBufferSnippet(bufnr: number, snippet: string | SnippetString, range: Range, insertTextMode?: InsertTextMode): Promise<boolean> {
    let release = await this.mutex.acquire()
    try {
      let document = workspace.getAttachedDocument(bufnr)
      const session = this.bufferSync.getItem(bufnr)
      range = toValidRange(range)
      const currentLine = document.getline(range.start.line)
      const snippetStr = SnippetString.isSnippetString(snippet) ? snippet.value : snippet
      const inserted = await this.normalizeInsertText(document.bufnr, snippetStr, currentLine, insertTextMode)
      let isActive = await session.start(inserted, range, false)
      release()
      return isActive
    } catch (e) {
      release()
      throw e
    }
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string | SnippetString, select = true, range?: Range | undefined, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption): Promise<boolean> {
    let { nvim } = workspace
    let release = await this.mutex.acquire()
    try {
      let document = workspace.getAttachedDocument(workspace.bufnr)
      const session = this.bufferSync.getItem(document.bufnr)
      let context: UltiSnippetContext
      range = await this.toRange(range)
      const currentLine = document.getline(range.start.line)
      const snippetStr = SnippetString.isSnippetString(snippet) ? snippet.value : snippet
      const inserted = await this.normalizeInsertText(document.bufnr, snippetStr, currentLine, insertTextMode, ultisnip)
      let usePy = false
      if (ultisnip != null) {
        usePy = hasPython(ultisnip) || inserted.includes('`!p')
        context = Object.assign({ range: deepClone(range), line: currentLine }, ultisnip)
        if (usePy) {
          if (session.placeholder) {
            let { placeholder } = session
            let { start, end } = placeholder.range
            let last = {
              current_text: placeholder.value,
              start: { line: start.line, col: start.character, character: start.character },
              end: { line: end.line, col: end.character, character: end.character }
            }
            this.nvim.setVar('coc_last_placeholder', last, true)
          } else {
            this.nvim.call('coc#compat#del_var', ['coc_last_placeholder'], true)
          }
          const codes = getInitialPythonCode(context)
          let preExpand = getAction(ultisnip, 'preExpand')
          if (preExpand) {
            await executePythonCode(nvim, codes.concat(['snip = coc_ultisnips_dict["PreExpandContext"]()', preExpand]))
            const [valid, pos] = await nvim.call('pyxeval', 'snip.getResult()') as [boolean, [number, number]]
            // need remove the trigger
            if (valid) {
              let count = range.end.character - range.start.character
              let end = Position.create(pos[0], pos[1])
              let start = Position.create(pos[0], Math.max(0, pos[1] - count))
              range = Range.create(start, end)
            } else {
              // trigger removed already
              let start = Position.create(pos[0], pos[1])
              range = Range.create(start, deepClone(start))
            }
          } else {
            await executePythonCode(nvim, codes)
          }
        }
        // same behavior as Ultisnips
        const { start } = range
        this.nvim.call('coc#cursor#move_to', [start.line, start.character], true)
        if (!emptyRange(range)) {
          await document.applyEdits([TextEdit.del(range)])
          range.end = Position.create(start.line, start.character)
        }
      }
      await session.start(inserted, range, select, context)
      release()
      return session.isActive
    } catch (e) {
      release()
      throw e
    }
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
  public async resolveSnippet(snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    let session = this.bufferSync.getItem(workspace.bufnr)
    if (!session) return
    let release = await this.mutex.acquire()
    try {
      let res = await session.resolveSnippet(this.nvim, snippetString, ultisnip)
      release()
      return res
    } catch (e) {
      release()
      throw e
    }
  }

  public async normalizeInsertText(bufnr: number, snippetString: string, currentLine: string, insertTextMode: InsertTextMode, ultisnip?: Partial<UltiSnippetOption>): Promise<string> {
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs || !shouldFormat(snippetString)) {
      inserted = snippetString
    } else {
      const currentIndent = currentLine.match(/^\s*/)[0]
      const formatOptions = window.activeTextEditor ? window.activeTextEditor.options : await workspace.getFormatOptions(bufnr) as SnippetFormatOptions
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
