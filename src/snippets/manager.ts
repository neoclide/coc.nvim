import { DidChangeTextDocumentParams, Disposable, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import * as types from '../types'
import workspace from '../workspace'
import { CompositeSnippetProvider } from './provider'
import { SnippetSession } from './session'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager implements types.SnippetManager {
  private session: SnippetSession
  private disposables: Disposable[] = []
  private _snippetProvider: CompositeSnippetProvider

  constructor() {
    this._snippetProvider = new CompositeSnippetProvider()
    workspace.onDidWorkspaceInitialized(() => {
      this.session = new SnippetSession(workspace.nvim)
    }, null, this.disposables)

    workspace.onDidChangeTextDocument((e: DidChangeTextDocumentParams) => {
      let { uri } = e.textDocument
      let { session } = this
      if (session && session.uri == uri) {
        session.synchronizeUpdatedPlaceholders(e.contentChanges[0]).catch(e => {
          logger.error(e)
        })
      }
    }, null, this.disposables)

    workspace.onDidCloseTextDocument(textDocument => {
      const { session } = this
      if (session && session.uri == textDocument.uri) {
        this.cancel()
      }
    }, null, this.disposables)

    let timer: NodeJS.Timer = null
    events.on(['CursorMoved', 'CursorMovedI'], () => {
      if (this.isSnippetActive) {
        timer = setTimeout(() => {
          if (!this.session) return
          this.session.onCursorMoved().catch(e => {
            logger.error(e)
          })
        }, 20)
      }
    }, null, this.disposables)
    events.on(['TextChanged', 'TextChangedI'], () => {
      if (timer) clearTimeout(timer)
    }, null, this.disposables)

    events.on('BufEnter', () => {
      this.cancel()
    }, null, this.disposables)
  }

  public get isSnippetActive(): boolean {
    return this.session && this.session.isActive
  }

  public async getSnippetsForLanguage(language: string): Promise<types.Snippet[]> {
    return this._snippetProvider.getSnippets(language)
  }

  public registerSnippetProvider(snippetProvider: types.SnippetProvider): void {
    this._snippetProvider.registerProvider(snippetProvider)
  }

  /**
   * Inserts snippet in the active editor, at current cursor position
   */
  public async insertSnippet(snippet: string): Promise<void> {
    if (!this.session) return
    await this.session.start(snippet)
  }

  public async nextPlaceholder(): Promise<void> {
    if (!this.session) return
    return this.session.nextPlaceholder()
  }

  public async previousPlaceholder(): Promise<void> {
    if (!this.session) return
    return this.session.previousPlaceholder()
  }

  public cancel(): void {
    if (this.session) {
      this.session.finish()
    }
  }

  public dispose(): void {
    this.cancel()
    this.disposables.forEach(d => d.dispose())
  }

  private drawCursors(_mode: string, _cursors: Range[]): void {
    // TODO draw cursors
  }
}

export default new SnippetManager()
