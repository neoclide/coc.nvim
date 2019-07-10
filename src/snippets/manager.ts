import { DidChangeTextDocumentParams, Disposable, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import * as types from '../types'
import workspace from '../workspace'
import * as Snippets from "./parser"
import { SnippetParser } from './parser'
import { SnippetSession } from './session'
import { SnippetVariableResolver } from './variableResolve'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager implements types.SnippetManager {
  private sessionMap: Map<number, SnippetSession> = new Map()
  private disposables: Disposable[] = []
  private statusItem: types.StatusBarItem

  constructor() {
    // tslint:disable-next-line:no-floating-promises
    workspace.ready.then(() => {
      let config = workspace.getConfiguration('coc.preferences')
      this.statusItem = workspace.createStatusBarItem(0)
      this.statusItem.text = config.get<string>('snippetStatusText', 'SNIP')
    })

    workspace.onDidChangeTextDocument(async (e: DidChangeTextDocumentParams) => {
      let { uri } = e.textDocument
      let doc = workspace.getDocument(uri)
      if (!doc) return
      let session = this.getSession(doc.bufnr)
      if (session && session.isActive) {
        await session.synchronizeUpdatedPlaceholders(e.contentChanges[0])
      }
    }, null, this.disposables)

    workspace.onDidCloseTextDocument(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      if (!doc) return
      let session = this.getSession(doc.bufnr)
      if (session) session.deactivate()
    }, null, this.disposables)

    events.on('BufEnter', async bufnr => {
      let session = this.getSession(bufnr)
      if (!this.statusItem) return
      if (session && session.isActive) {
        this.statusItem.show()
      } else {
        this.statusItem.hide()
      }
    }, null, this.disposables)

    events.on('InsertEnter', async () => {
      let { session } = this
      if (!session) return
      await session.checkPosition()
    }, null, this.disposables)
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string, select = true, range?: Range): Promise<boolean> {
    let { nvim } = workspace
    let bufnr = await nvim.call('bufnr', '%')
    let session = this.getSession(bufnr)
    if (!session) {
      session = new SnippetSession(workspace.nvim, bufnr)
      this.sessionMap.set(bufnr, session)
      session.onCancel(() => {
        this.sessionMap.delete(bufnr)
        if (workspace.bufnr == bufnr) {
          this.statusItem.hide()
        }
      })
    }
    let isActive = await session.start(snippet, select, range)
    if (isActive) {
      this.statusItem.show()
    } else if (session) {
      session.deactivate()
    }
    nvim.command('silent! unlet g:coc_last_placeholder g:coc_selected_text', true)
    return isActive
  }

  public isPlainText(text: string): boolean {
    let snippet = (new SnippetParser()).parse(text, true)
    if (snippet.placeholders.every(p => p.isFinalTabstop == true && p.toString() == '')) {
      return true
    }
    return false
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    let { session } = this
    if (session) return await session.selectCurrentPlaceholder(triggerAutocmd)
  }

  public async nextPlaceholder(): Promise<void> {
    let { session } = this
    if (session) return await session.nextPlaceholder()
    workspace.nvim.call('coc#snippet#disable', [], true)
    this.statusItem.hide()
  }

  public async previousPlaceholder(): Promise<void> {
    let { session } = this
    if (session) return await session.previousPlaceholder()
    workspace.nvim.call('coc#snippet#disable', [], true)
    this.statusItem.hide()
  }

  public cancel(): void {
    let session = this.getSession(workspace.bufnr)
    if (session) return session.deactivate()
    workspace.nvim.call('coc#snippet#disable', [], true)
    if (this.statusItem) this.statusItem.hide()
  }

  public get session(): SnippetSession {
    let session = this.getSession(workspace.bufnr)
    return session && session.isActive ? session : null
  }

  public isActived(bufnr: number): boolean {
    let session = this.getSession(bufnr)
    return session && session.isActive
  }

  public jumpable(): boolean {
    let { session } = this
    if (!session) return false
    let placeholder = session.placeholder
    if (placeholder && !placeholder.isFinalTabstop) {
      return true
    }
    return false
  }

  public getSession(bufnr: number): SnippetSession {
    return this.sessionMap.get(bufnr)
  }

  public async resolveSnippet(body: string): Promise<Snippets.TextmateSnippet> {
    let parser = new Snippets.SnippetParser()
    const snippet = parser.parse(body, true)
    const resolver = new SnippetVariableResolver()
    snippet.resolveVariables(resolver)
    return snippet
  }

  public dispose(): void {
    this.cancel()
    for (let d of this.disposables) {
      d.dispose()
    }
  }
}

export default new SnippetManager()
