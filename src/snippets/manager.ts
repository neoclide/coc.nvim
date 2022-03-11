import { Disposable, InsertTextMode, Range } from 'vscode-languageserver-protocol'
import events from '../events'
import { StatusBarItem } from '../model/status'
import { UltiSnippetOption } from '../types'
import window from '../window'
import workspace from '../workspace'
import { SnippetSession } from './session'
import { SnippetString } from './string'
const logger = require('../util/logger')('snippets-manager')

export class SnippetManager {
  private sessionMap: Map<number, SnippetSession> = new Map()
  private disposables: Disposable[] = []
  private statusItem: StatusBarItem
  private highlight: boolean

  constructor() {
    events.on(['TextChanged', 'TextChangedI'], bufnr => {
      let session = this.getSession(bufnr as number)
      if (session) session.sychronize()
    }, null, this.disposables)
    events.on('CompleteDone', () => {
      let session = this.getSession(workspace.bufnr)
      if (session) session.sychronize()
    }, null, this.disposables)
    events.on('BufUnload', bufnr => {
      let session = this.getSession(bufnr)
      if (session) session.deactivate()
    }, null, this.disposables)
    window.onDidChangeActiveTextEditor(e => {
      if (!this.statusItem) return
      let session = this.getSession(e.document.bufnr)
      if (session) {
        this.statusItem.show()
      } else {
        this.statusItem.hide()
      }
    }, null, this.disposables)
    events.on('InsertEnter', async bufnr => {
      let session = this.getSession(bufnr)
      if (session) await session.checkPosition()
    }, null, this.disposables)
  }

  public init(): void {
    let config = workspace.getConfiguration('coc.preferences')
    this.statusItem = window.createStatusBarItem(0)
    this.statusItem.text = config.get<string>('snippetStatusText', 'SNIP')
    this.highlight = config.get<boolean>('snippetHighlight', false)
  }

  /**
   * Insert snippet at current cursor position
   */
  public async insertSnippet(snippet: string | SnippetString, select = true, range?: Range, insertTextMode?: InsertTextMode, ultisnip?: UltiSnippetOption): Promise<boolean> {
    let { bufnr } = workspace
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return false
    let session = this.getSession(bufnr)
    if (!session) {
      session = new SnippetSession(workspace.nvim, bufnr, this.highlight)
      this.sessionMap.set(bufnr, session)
      session.onCancel(() => {
        this.sessionMap.delete(bufnr)
        this.statusItem.hide()
      })
    }
    let snippetStr = SnippetString.isSnippetString(snippet) ? snippet.value : snippet
    let isActive = await session.start(snippetStr, select, range, insertTextMode, ultisnip)
    if (isActive) {
      this.sessionMap.set(bufnr, session)
      this.statusItem.show()
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

  public async resolveSnippet(snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    return await SnippetSession.resolveSnippet(workspace.nvim, snippetString, ultisnip)
  }

  public dispose(): void {
    this.cancel()
    for (let d of this.disposables) {
      d.dispose()
    }
  }
}

export default new SnippetManager()
