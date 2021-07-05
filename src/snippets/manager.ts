import { Disposable, InsertTextMode, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import { StatusBarItem } from '../model/status'
import workspace from '../workspace'
import window from '../window'
import * as Snippets from "./parser"
import { SnippetSession } from './session'
import { SnippetVariableResolver } from './variableResolve'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager {
  private sessionMap: Map<number, SnippetSession> = new Map()
  private disposables: Disposable[] = []
  private statusItem: StatusBarItem

  constructor() {
    workspace.onDidChangeTextDocument(async e => {
      let session = this.getSession(e.bufnr)
      if (session) {
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

  public init(): void {
    let config = workspace.getConfiguration('coc.preferences')
    this.statusItem = window.createStatusBarItem(0)
    this.statusItem.text = config.get<string>('snippetStatusText', 'SNIP')
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string, select = true, range?: Range, insertTextMode?: InsertTextMode): Promise<boolean> {
    let { bufnr } = workspace
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
    let isActive = await session.start(snippet, select, range, insertTextMode)
    if (isActive) this.statusItem.show()
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
      workspace.nvim.call('coc#snippet#disable', [], true)
      this.statusItem.hide()
    }
    return ''
  }

  public async previousPlaceholder(): Promise<string> {
    let { session } = this
    if (session) {
      await session.previousPlaceholder()
    } else {
      workspace.nvim.call('coc#snippet#disable', [], true)
      this.statusItem.hide()
    }
    return ''
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
    await snippet.resolveVariables(resolver)
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
