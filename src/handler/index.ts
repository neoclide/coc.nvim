'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CodeAction, CodeActionKind, Location, Position, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import Document from '../model/document'
import { StatusBarItem } from '../model/status'
import { TextDocumentMatch } from '../types'
import { disposeAll, getConditionValue } from '../util'
import { getSymbolKind } from '../util/convert'
import { toObject } from '../util/object'
import { CancellationToken, CancellationTokenSource, Disposable } from '../util/protocol'
import { getRangesFromEdit } from '../util/textedit'
import window from '../window'
import workspace from '../workspace'
import CallHierarchy from './callHierarchy'
import CodeActions from './codeActions'
import CodeLens from './codelens/index'
import Colors from './colors/index'
import Commands from './commands'
import Fold from './fold'
import Format from './format'
import Highlights from './highlights'
import HoverHandler from './hover'
import InlayHintHandler from './inlayHint/index'
import LinkedEditingHandler from './linkedEditing'
import Links from './links'
import Locations from './locations'
import Refactor from './refactor/index'
import Rename from './rename'
import SelectionRange from './selectionRange'
import SemanticTokens from './semanticTokens/index'
import Signature from './signature'
import Symbols from './symbols/index'
import TypeHierarchy from './typeHierarchy'
import { HandlerDelegate } from './types'
import WorkspaceHandler from './workspace'
const logger = createLogger('Handler')
const requestTimeout = getConditionValue(500, 10)

export interface CurrentState {
  doc: Document
  winid: number
  position: Position
  // :h mode()
  mode: string
}

export default class Handler implements HandlerDelegate {
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
  public readonly typeHierarchy: TypeHierarchy
  public readonly semanticHighlighter: SemanticTokens
  public readonly workspace: WorkspaceHandler
  public readonly linkedEditingHandler: LinkedEditingHandler
  public readonly inlayHintHandler: InlayHintHandler
  private _requestStatusItem: StatusBarItem
  private requestTokenSource: CancellationTokenSource | undefined
  private requestTimer: NodeJS.Timer
  private disposables: Disposable[] = []

  constructor(private nvim: Neovim) {
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
    this.workspace = new WorkspaceHandler(nvim)
    this.codeActions = new CodeActions(nvim, this)
    this.commands = new Commands(nvim)
    this.callHierarchy = new CallHierarchy(nvim, this)
    this.typeHierarchy = new TypeHierarchy(nvim, this)
    this.documentHighlighter = new Highlights(nvim, this)
    this.semanticHighlighter = new SemanticTokens(nvim)
    this.selectionRange = new SelectionRange(nvim, this)
    this.linkedEditingHandler = new LinkedEditingHandler(nvim, this)
    this.inlayHintHandler = new InlayHintHandler(nvim, this)
    this.disposables.push({
      dispose: () => {
        this.callHierarchy.dispose()
        this.typeHierarchy.dispose()
        this.codeLens.dispose()
        this.links.dispose()
        this.refactor.dispose()
        this.signature.dispose()
        this.symbols.dispose()
        this.hover.dispose()
        this.colors.dispose()
        this.documentHighlighter.dispose()
        this.semanticHighlighter.dispose()
      }
    })
    this.registerCommands()
  }

  private registerCommands(): void {
    commands.register({
      id: 'document.renameCurrentWord',
      execute: async () => {
        let doc = await workspace.document
        let edit = await this.rename.getWordEdit()
        let ranges = getRangesFromEdit(doc.uri, toObject(edit))
        if (!ranges) return window.showWarningMessage('Invalid position')
        await commands.executeCommand('editor.action.addRanges', ranges)
      }
    }, false, 'rename word under cursor in current buffer by multiple cursors.')
    commands.register({
      id: ['workbench.action.reloadWindow', 'editor.action.restart'],
      execute: () => {
        this.nvim.command('CocRestart', true)
      }
    }, true)

    this.register('vscode.open', async (url: string | URI) => {
      await workspace.openResource(url.toString())
    })
    this.register('editor.action.doCodeAction', async (action: CodeAction) => {
      await this.codeActions.applyCodeAction(action)
    })
    this.register('editor.action.triggerParameterHints', async () => {
      await this.signature.triggerSignatureHelp()
    })
    this.register('editor.action.showReferences', async (uri: string | URI, position: Position, references: Location[]) => {
      await workspace.jumpTo(uri, position)
      await workspace.showLocations(references)
    })
    this.register('editor.action.rename', async (uri: string | URI | [URI, Position], position: Position, newName?: string) => {
      if (Array.isArray(uri)) {
        position = uri[1]
        uri = uri[0]
      }
      await workspace.jumpTo(uri, position)
      return await this.rename.rename(newName)
    })
    this.register('editor.action.format', async () => {
      await this.format.formatCurrentBuffer()
    })
    this.register('editor.action.showRefactor', async (locations: Location[]) => {
      let locs = locations.filter(o => Location.is(o))
      return await this.refactor.fromLocations(locs)
    })
  }

  private register<T>(key, handler: (...args: any[]) => T | Promise<T>): void {
    this.disposables.push(commands.registerCommand(key, handler, null, true))
  }

  private get requestStatusItem(): StatusBarItem {
    if (this._requestStatusItem) return this._requestStatusItem
    this._requestStatusItem = window.createStatusBarItem(0, { progress: true })
    return this._requestStatusItem
  }

  private get labels(): { [key: string]: string } {
    let configuration = workspace.initialConfiguration
    return configuration.get('suggest.completionItemKindLabels', {})
  }

  public get uri(): string | undefined {
    return window.activeTextEditor?.document.uri
  }

  public async getCurrentState(): Promise<CurrentState> {
    let { nvim } = this
    let [bufnr, [line, character], winid, mode] = await nvim.eval("[bufnr('%'),coc#cursor#position(),win_getid(),mode()]") as [number, [number, number], number, string]
    let doc = workspace.getAttachedDocument(bufnr)
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
   * Throw error when provider doesn't exist.
   */
  public checkProvider(id: ProviderName, document: TextDocumentMatch): void {
    if (!languages.hasProvider(id, document)) {
      throw new Error(`${id} provider not found for current buffer, your language server doesn't support it.`)
    }
  }

  public async withRequestToken<T>(name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean): Promise<T | null> {
    if (this.requestTokenSource) {
      this.requestTokenSource.cancel()
      this.requestTokenSource.dispose()
    }
    clearTimeout(this.requestTimer)
    let statusItem = this.requestStatusItem
    this.requestTokenSource = new CancellationTokenSource()
    let { token } = this.requestTokenSource
    token.onCancellationRequested(() => {
      statusItem.text = `${name} request canceled`
      statusItem.isProgress = false
      this.requestTimer = setTimeout(() => {
        statusItem.hide()
      }, requestTimeout)
    })
    statusItem.isProgress = true
    statusItem.text = `requesting ${name}`
    statusItem.show()
    let res: T
    try {
      res = await Promise.resolve(fn(token))
    } catch (e) {
      logger.error(`Error on request ${name}`, e)
      this.nvim.errWriteLine(`Error on ${name}: ${e}`)
    }
    if (this.requestTokenSource) {
      this.requestTokenSource.dispose()
      this.requestTokenSource = undefined
    }
    if (token.isCancellationRequested) return null
    statusItem.hide()
    if (checkEmpty && (!res || (Array.isArray(res) && res.length == 0))) {
      void window.showWarningMessage(`${name} not found`)
      return null
    }
    return res
  }

  public getIcon(kind: SymbolKind): { text: string, hlGroup: string } {
    let { labels } = this
    let kindText = getSymbolKind(kind)
    let defaultIcon = typeof labels['default'] === 'string' ? labels['default'] : kindText[0].toLowerCase()
    let text = kindText == 'Unknown' ? '' : labels[kindText[0].toLowerCase() + kindText.slice(1)]
    if (!text) text = defaultIcon
    return {
      text,
      hlGroup: kindText == 'Unknown' ? 'CocSymbolDefault' : `CocSymbol${kindText}`
    }
  }

  public async getCodeActions(doc: Document, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]> {
    let codeActions = await this.codeActions.getCodeActions(doc, range, only)
    return codeActions.filter(o => !o.disabled)
  }

  public async applyCodeAction(action: CodeAction): Promise<void> {
    await this.codeActions.applyCodeAction(action)
  }

  public async hasProvider(id: string): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', '%') as number
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return false
    return languages.hasProvider(id as ProviderName, doc.textDocument)
  }

  public dispose(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
    }
    disposeAll(this.disposables)
  }
}
