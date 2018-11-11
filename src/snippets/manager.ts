import { DidChangeTextDocumentParams, Disposable, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import * as types from '../types'
import workspace from '../workspace'
import { CompositeSnippetProvider } from './provider'
import { SnippetSession } from './session'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager implements types.SnippetManager {
  private _activeSession: SnippetSession
  private _disposables: Disposable[] = []
  private disposables: Disposable[] = []
  private _snippetProvider: CompositeSnippetProvider

  public get isSnippetActive(): boolean {
    return !!this._activeSession
  }

  constructor() {
    this._snippetProvider = new CompositeSnippetProvider()

    workspace.onDidChangeTextDocument((e: DidChangeTextDocumentParams) => {
      let { uri } = e.textDocument
      const activeSession = this._activeSession
      if (activeSession) {
        if (activeSession.document.uri == uri) {
          activeSession.synchronizeUpdatedPlaceholders(e.contentChanges[0]).catch(e => {
            logger.error(e)
          })
        }
      }
    }, null, this.disposables)

    workspace.onDidCloseTextDocument(textDocument => {
      const activeSession = this._activeSession
      if (activeSession) {
        if (activeSession.document.uri == textDocument.uri) {
          this.cancel()
        }
      }
    }, null, this.disposables)

    events.on(['CursorMoved', 'CursorMovedI'], () => {
      if (this.isSnippetActive) {
        this._activeSession.updateCursorPosition().catch(e => {
          logger.error(e)
        })
      }
    }, null, this.disposables)
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
    this.cancel()
    const snippetSession = new SnippetSession(workspace.nvim, snippet)
    await snippetSession.start()
    await workspace.nvim.call('coc#snippet#enable')
    snippetSession.onCancel(() => {
      this.cancel()
    }, null, this._disposables)
    snippetSession.onCursorMoved(event => {
      this.drawCursors(event.mode, event.cursors)
    }, null, this._disposables)
    this._activeSession = snippetSession
  }

  public async nextPlaceholder(): Promise<void> {
    if (this.isSnippetActive) {
      return this._activeSession.nextPlaceholder()
    }
  }

  public async previousPlaceholder(): Promise<void> {
    if (this.isSnippetActive) {
      return this._activeSession.previousPlaceholder()
    }
  }

  public cancel(): void {
    if (this._activeSession) {
      workspace.nvim.call('coc#snippet#disable', [], true)
      logger.debug("[SnippetManager::cancel]")
      this._disposables.forEach(d => d.dispose())
      this._disposables = []
      this._activeSession = null
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
