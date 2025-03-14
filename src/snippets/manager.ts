'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import events from '../events'
import BufferSync from '../model/bufferSync'
import { StatusBarItem } from '../model/status'
import { UltiSnippetOption } from '../types'
import { defaultValue } from '../util'
import { Mutex } from '../util/mutex'
import { deepClone } from '../util/object'
import { emptyRange, rangeOverlap, toValidRange } from '../util/position'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode, getInitialPythonCode, hasPython } from './eval'
import { SnippetConfig, SnippetSession } from './session'
import { normalizeSnippetString, shouldFormat } from './snippet'
import { SnippetString } from './string'
import { getAction, SnippetFormatOptions, UltiSnippetContext } from './util'

export class SnippetManager {
  private disposables: Disposable[] = []
  private _statusItem: StatusBarItem
  private bufferSync: BufferSync<SnippetSession>
  private resolving = false
  private mutex: Mutex = new Mutex()

  public init() {
    events.on('InsertCharPre', (_, bufnr: number) => {
      // avoid update session when pumvisible
      // Update may cause completion unexpected terminated.
      let session = this.getSession(bufnr)
      if (session) session.cancel()
    }, null, this.disposables)
    events.on('InsertEnter', async bufnr => {
      let session = this.getSession(bufnr)
      if (session) await session.checkPosition()
    }, null, this.disposables)

    this.bufferSync = workspace.registerBufferSync(doc => {
      let config = this.getSnippetConfig(doc.uri)
      let session = new SnippetSession(this.nvim, doc, config)
      session.onActiveChange(isActive => {
        if (window.activeTextEditor?.bufnr !== session.bufnr) return
        this.statusItem[isActive ? 'show' : 'hide']()
      })
      return session
    })
    this.disposables.push(this.bufferSync)

    window.onDidChangeActiveTextEditor(e => {
      if (!this._statusItem || this.getSession(e.bufnr) == null) return
      let session = this.getSession(e.bufnr)
      if (session) {
        this.statusItem[session.isActive ? 'show' : 'hide']()
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

  private getSnippetConfig(resource: string): SnippetConfig {
    let config = workspace.getConfiguration('coc.preferences', resource)
    const snippetConfig = workspace.getConfiguration('snippet', resource)
    const suggest = workspace.getConfiguration('suggest', resource)
    return {
      highlight: config.get<boolean>('snippetHighlight', snippetConfig.get<boolean>('highlight', false)),
      nextOnDelete: config.get<boolean>('nextPlaceholderOnDelete', snippetConfig.get<boolean>('nextPlaceholderOnDelete', false)),
      preferComplete: suggest.get<boolean>('preferCompleteThanJumpPlaceholder', false)
    }
  }

  private async toRange(range: Range | undefined): Promise<Range> {
    if (range) return toValidRange(range)
    let pos = await window.getCursorPosition()
    return Range.create(pos, pos)
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string | SnippetString, select = true, range?: Range, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption, checkResolve = false): Promise<boolean> {
    if (checkResolve && this.resolving) return false
    let { bufnr, nvim } = workspace
    let doc = workspace.getAttachedDocument(bufnr)
    let release = await this.mutex.acquire()
    try {
      let context: UltiSnippetContext
      range = await this.toRange(range)
      const currentLine = doc.getline(range.start.line)
      const snippetStr = SnippetString.isSnippetString(snippet) ? snippet.value : snippet
      const inserted = await this.normalizeInsertText(doc.uri, snippetStr, currentLine, insertTextMode, ultisnip)
      let usePy = false
      if (ultisnip != null) {
        usePy = hasPython(ultisnip) || inserted.includes('`!p')
        context = Object.assign({ range: deepClone(range), line: currentLine }, ultisnip)
        if (usePy) {
          await executePythonCode(nvim, getInitialPythonCode(context))
          let preExpand = getAction(ultisnip, 'preExpand')
          if (preExpand) {
            await executePythonCode(nvim, ['snip = coc_ultisnips_dict["PreExpandContext"]()', preExpand])
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
          }
        }
        // same behavior as Ultisnips
        this.nvim.call('coc#cursor#move_to', [range.start.line, range.start.character], true)
        if (!emptyRange(range)) {
          await doc.applyEdits([TextEdit.del(range)])
          range.end = Position.create(range.start.line, range.start.character)
        }
      }
      let session = this.getSession(bufnr)
      // could be buffer detach
      if (!session) return false
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
    let session = this.getSession(workspace.bufnr)
    if (session) return session.deactivate()
    this.nvim.call('coc#snippet#disable', [], true)
    this.statusItem.hide()
  }

  public get session(): SnippetSession {
    return this.getSession(workspace.bufnr)
  }

  public getSession(bufnr: number): SnippetSession {
    return this.bufferSync.getItem(bufnr)
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

  public async editsInsideSnippet(edits: TextEdit[]): Promise<boolean> {
    let session = this.getSession(workspace.bufnr)
    if (!session || !session.snippet) return false
    await session.forceSynchronize()
    let range = session.snippet.range
    if (edits.some(e => rangeOverlap(e.range, range))) {
      return true
    }
    return false
  }

  public async resolveSnippet(snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    if (ultisnip) {
      let session = this.getSession(workspace.bufnr)
      if (session && session.snippet?.hasPython) ultisnip.noPython = false
    }
    let res: string
    try {
      this.resolving = true
      res = await SnippetSession.resolveSnippet(this.nvim, snippetString, ultisnip)
    } catch (e) {
      this.resolving = false
      throw e
    }
    this.resolving = false
    return res
  }

  public async normalizeInsertText(uri: string, snippetString: string, currentLine: string, insertTextMode: InsertTextMode, ultisnip?: Partial<UltiSnippetOption>): Promise<string> {
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs || !shouldFormat(snippetString)) {
      inserted = snippetString
    } else {
      const currentIndent = currentLine.match(/^\s*/)[0]
      const formatOptions = window.activeTextEditor ? window.activeTextEditor.options : await workspace.getFormatOptions(uri) as SnippetFormatOptions
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
    for (let d of this.disposables) {
      d.dispose()
    }
  }
}

export default new SnippetManager()
