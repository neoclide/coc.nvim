import { DidChangeTextDocumentParams, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import * as types from '../types'
import workspace from '../workspace'
import { CompositeSnippetProvider } from './provider'
import { SnippetSession } from './session'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager implements types.SnippetManager {
  private sessionMap: Map<number, SnippetSession> = new Map()
  private disposables: Disposable[] = []
  private snippetProvider: CompositeSnippetProvider
  private statusItem: types.StatusBarItem

  constructor() {
    this.snippetProvider = new CompositeSnippetProvider()
    workspace.onDidWorkspaceInitialized(() => {
      this.statusItem = workspace.createStatusBarItem(0)
      this.statusItem.text = 'SNIP'
    }, null, this.disposables)

    workspace.onDidChangeTextDocument(async (e: DidChangeTextDocumentParams) => {
      let { uri } = e.textDocument
      let doc = workspace.getDocument(uri)
      let session = this.getSession(doc.bufnr)
      if (session && session.isActive) {
        await session.synchronizeUpdatedPlaceholders(e.contentChanges[0])
      }
    }, null, this.disposables)

    workspace.onDidCloseTextDocument(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      if (!doc) return
      let session = this.getSession(doc.bufnr)
      if (session) this.sessionMap.delete(session.bufnr)
    }, null, this.disposables)

    events.on('BufEnter', async bufnr => {
      let session = this.getSession(bufnr)
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

  public registerSnippetProvider(snippetProvider: types.SnippetProvider): Disposable {
    return this.snippetProvider.registerProvider(snippetProvider)
  }

  public async getSnippetsForLanguage(language: string): Promise<types.Snippet[]> {
    return this.snippetProvider.getSnippets(language)
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string): Promise<boolean> {
    let bufnr = await workspace.nvim.call('bufnr', '%')
    let session = this.getSession(bufnr)
    let disposable: Disposable
    if (!session) {
      session = new SnippetSession(workspace.nvim, bufnr)
      disposable = session.onCancel(() => {
        this.sessionMap.delete(bufnr)
        if (workspace.bufnr == bufnr) {
          this.statusItem.hide()
        }
      })
    }
    let isActive = await session.start(snippet)
    if (isActive) {
      this.sessionMap.set(bufnr, session)
      this.statusItem.show()
    } else if (disposable) {
      disposable.dispose()
    }
    return isActive
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
    this.statusItem.hide()
  }

  public get session(): SnippetSession {
    let session = this.getSession(workspace.bufnr)
    return session && session.isActive ? session : null
  }

  public getSession(bufnr: number): SnippetSession {
    return this.sessionMap.get(bufnr)
  }

  public dispose(): void {
    this.cancel()
    for (let d of this.disposables) {
      d.dispose()
    }
  }
}

export default new SnippetManager()
