'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import events from '../events'
import { StatusBarItem } from '../model/status'
import { UltiSnippetOption } from '../types'
import { defaultValue } from '../util'
import { deepClone } from '../util/object'
import { emptyRange, rangeInRange, rangeOverlap } from '../util/position'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { UltiSnippetContext } from './eval'
import { SnippetConfig, SnippetSession } from './session'
import { normalizeSnippetString, shouldFormat } from './snippet'
import { SnippetString } from './string'

export class SnippetManager {
  private sessionMap: Map<number, SnippetSession> = new Map()
  private disposables: Disposable[] = []
  private _statusItem: StatusBarItem

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
    workspace.onDidCloseTextDocument(e => {
      let session = this.getSession(e.bufnr)
      if (session) session.deactivate()
    }, null, this.disposables)
    window.onDidChangeActiveTextEditor(e => {
      if (!this._statusItem) return
      let session = this.getSession(e.document.bufnr)
      if (session) {
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

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string | SnippetString, select = true, range?: Range, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption): Promise<boolean> {
    let { bufnr } = workspace
    let doc = workspace.getAttachedDocument(bufnr)
    if (range && !rangeInRange(range, Range.create(0, 0, doc.lineCount + 1, 0))) {
      throw new Error(`Unable to insert snippet, invalid range.`)
    }
    let context: UltiSnippetContext
    if (!range) {
      let pos = await window.getCursorPosition()
      range = Range.create(pos, pos)
    }
    const currentLine = doc.getline(range.start.line)
    const snippetStr = SnippetString.isSnippetString(snippet) ? snippet.value : snippet
    const inserted = await this.normalizeInsertText(doc.uri, snippetStr, currentLine, insertTextMode)
    if (ultisnip != null) {
      context = Object.assign({ range: deepClone(range), line: currentLine }, ultisnip)
      if (!emptyRange(range) && inserted.includes('`!p')) {
        // same behavior as Ultisnips
        this.nvim.call('coc#cursor#move_to', [range.start.line, range.start.character], true)
        await doc.applyEdits([{ range, newText: '' }])
        range.end = Position.create(range.start.line, range.start.character)
      }
    }
    let session = this.getSession(bufnr)
    if (session) {
      await session.forceSynchronize()
      // current session could be canceled on synchronize.
      session = this.getSession(bufnr)
    } else {
      await doc.patchChange(true)
    }
    if (!session) {
      let config = this.getSnippetConfig(doc.uri)
      session = new SnippetSession(this.nvim, doc, config)
      session.onCancel(() => {
        this.sessionMap.delete(bufnr)
        this.statusItem.hide()
      })
    }
    let isActive = await session.start(inserted, range, select, context)
    if (isActive) {
      this.statusItem.show()
      this.sessionMap.set(bufnr, session)
    } else {
      this.statusItem.hide()
      this.sessionMap.delete(bufnr)
    }
    return isActive
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
      this.statusItem.hide()
    }
    return ''
  }

  public async previousPlaceholder(): Promise<string> {
    let { session } = this
    if (session) {
      await session.previousPlaceholder()
    } else {
      this.nvim.call('coc#snippet#disable', [], true)
      this.statusItem.hide()
    }
    return ''
  }

  public cancel(): void {
    let session = this.getSession(workspace.bufnr)
    if (session) return session.deactivate()
    this.nvim.call('coc#snippet#disable', [], true)
    if (this.statusItem) this.statusItem.hide()
  }

  public get session(): SnippetSession {
    return this.getSession(workspace.bufnr)
  }

  public getSession(bufnr: number): SnippetSession {
    return this.sessionMap.get(bufnr)
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
      if (session != null && session.snippet.hasPython) ultisnip.noPython = false
    }
    return await SnippetSession.resolveSnippet(this.nvim, snippetString, ultisnip)
  }

  public async normalizeInsertText(uri: string, snippetString: string, currentLine: string, insertTextMode: InsertTextMode): Promise<string> {
    let inserted = ''
    if (insertTextMode === InsertTextMode.asIs || !shouldFormat(snippetString)) {
      inserted = snippetString
    } else {
      const currentIndent = currentLine.match(/^\s*/)[0]
      const formatOptions = window.activeTextEditor ? window.activeTextEditor.options : await workspace.getFormatOptions(uri)
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
