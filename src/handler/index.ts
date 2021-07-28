import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import events from '../events'
import languages from '../languages'
import Document from '../model/document'
import { StatusBarItem } from '../model/status'
import { ProviderName } from '../types'
import { disposeAll } from '../util'
import window from '../window'
import workspace from '../workspace'
import CodeActions from './codeActions'
import CodeLens from './codelens/index'
import Colors from './colors/index'
import Commands from './commands'
import Fold from './fold'
import Format from './format'
import Highlights from './highlights'
import HoverHandler from './hover'
import Links from './links'
import Locations from './locations'
import Refactor from './refactor/index'
import Rename from './rename'
import SelectionRange from './selectionRange'
import CallHierarchy from './callHierarchy'
import SemanticTokensHighlights from './semanticTokensHighlights/index'
import Signature from './signature'
import Symbols from './symbols/index'
const logger = require('../util/logger')('Handler')

export interface CurrentState {
  doc: Document
  winid: number
  position: Position
  // :h mode()
  mode: string
}

export default class Handler {
  public readonly documentHighlighter: Highlights
  public readonly colors: Colors
  public readonly signature: Signature
  public readonly locations: Locations
  public readonly symbols: Symbols
  public readonly refactor: Refactor
  public readonly codeActions: CodeActions
  public readonly format: Format
  public readonly hover: HoverHandler
  public readonly codeLens: CodeLens
  public readonly commands: Commands
  public readonly links: Links
  public readonly rename: Rename
  public readonly fold: Fold
  public readonly selectionRange: SelectionRange
  public readonly callHierarchy: CallHierarchy
  public readonly semanticHighlighter: SemanticTokensHighlights
  private requestStatusItem: StatusBarItem
  private requestTokenSource: CancellationTokenSource | undefined
  private requestTimer: NodeJS.Timer
  private disposables: Disposable[] = []

  constructor(private nvim: Neovim) {
    this.requestStatusItem = window.createStatusBarItem(0, { progress: true })
    events.on(['CursorMoved', 'CursorMovedI', 'InsertEnter', 'InsertSnippet', 'InsertLeave'], () => {
      if (this.requestTokenSource) {
        this.requestTokenSource.cancel()
        this.requestTokenSource = null
      }
    }, null, this.disposables)
    this.fold = new Fold(nvim, this)
    this.links = new Links(nvim, this)
    this.codeLens = new CodeLens(nvim)
    this.colors = new Colors(nvim, this)
    this.format = new Format(nvim, this)
    this.symbols = new Symbols(nvim, this)
    this.refactor = new Refactor(nvim, this)
    this.hover = new HoverHandler(nvim, this)
    this.locations = new Locations(nvim, this)
    this.signature = new Signature(nvim, this)
    this.rename = new Rename(nvim, this)
    this.codeActions = new CodeActions(nvim, this)
    this.commands = new Commands(nvim, workspace.env)
    this.callHierarchy = new CallHierarchy(nvim, this)
    this.documentHighlighter = new Highlights(nvim, this)
    this.semanticHighlighter = new SemanticTokensHighlights(nvim, this)
    this.selectionRange = new SelectionRange(nvim, this)
    this.disposables.push({
      dispose: () => {
        this.codeLens.dispose()
        this.refactor.dispose()
        this.signature.dispose()
        this.symbols.dispose()
        this.hover.dispose()
        this.locations.dispose()
        this.colors.dispose()
        this.documentHighlighter.dispose()
        this.semanticHighlighter.dispose()
      }
    })
  }

  public async getCurrentState(): Promise<CurrentState> {
    let { nvim } = this
    let [bufnr, [line, character], winid, mode] = await nvim.eval("[bufnr('%'),coc#util#cursor(),win_getid(),mode()]") as [number, [number, number], number, string]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) throw new Error(`current buffer ${bufnr} not attached`)
    return {
      doc,
      mode,
      position: Position.create(line, character),
      winid
    }
  }

  public addDisposable(disposable: Disposable): void {
    this.disposables.push(disposable)
  }

  /**
   * Throw error when provider not exists.
   */
  public checkProvier(id: ProviderName, document: TextDocument): void {
    if (!languages.hasProvider(id, document)) {
      throw new Error(`${id} provider not found for current buffer, your language server doesn't support it.`)
    }
  }

  public async withRequestToken<T>(name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean): Promise<T | null> {
    if (this.requestTokenSource) {
      this.requestTokenSource.cancel()
      this.requestTokenSource.dispose()
    }
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
    }
    let statusItem = this.requestStatusItem
    this.requestTokenSource = new CancellationTokenSource()
    let { token } = this.requestTokenSource
    token.onCancellationRequested(() => {
      statusItem.text = `${name} request canceled`
      statusItem.isProgress = false
      this.requestTimer = setTimeout(() => {
        statusItem.hide()
      }, 500)
    })
    statusItem.isProgress = true
    statusItem.text = `requesting ${name}`
    statusItem.show()
    let res: T
    try {
      res = await Promise.resolve(fn(token))
    } catch (e) {
      window.showMessage(e.message, 'error')
      logger.error(`Error on ${name}`, e)
    }
    if (this.requestTokenSource) {
      this.requestTokenSource.dispose()
      this.requestTokenSource = undefined
    }
    if (token.isCancellationRequested) return null
    statusItem.hide()
    if (checkEmpty && (!res || (Array.isArray(res) && res.length == 0))) {
      window.showMessage(`${name} not found`, 'warning')
      return null
    }
    return res
  }

  public async hasProvider(id: string): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    return languages.hasProvider(id as ProviderName, doc.textDocument)
  }

  public dispose(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
    }
    disposeAll(this.disposables)
  }
}
