import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { CallHierarchyItem, CancellationToken, CancellationTokenSource, Disposable, DocumentLink, Location, Position, Range, SelectionRange, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commandManager from '../commands'
import events from '../events'
import languages from '../languages'
import listManager from '../list/manager'
import { CurrentState, ProviderName, StatusBarItem } from '../types'
import { disposeAll } from '../util'
import { equals } from '../util/object'
import { emptyRange, positionInRange } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import CodeActions from './codeActions'
import CodeLens from './codelens/index'
import Colors from './colors/index'
import Format from './format'
import Highlights from './highlights'
import HoverHandler from './hover'
import Locations from './locations'
import Refactor from './refactor/index'
import { Highlight } from './semanticTokensHighlights/buffer'
import SemanticTokensHighlights from './semanticTokensHighlights/index'
import Signature from './signature'
import Symbols from './symbols'
const logger = require('../util/logger')('Handler')

interface CommandItem {
  id: string
  title: string
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
  private semanticHighlighter: SemanticTokensHighlights
  private selectionRange: SelectionRange = null
  private requestStatusItem: StatusBarItem
  private requestTokenSource: CancellationTokenSource | undefined
  private requestTimer: NodeJS.Timer
  private disposables: Disposable[] = []

  constructor(private nvim: Neovim) {
    this.requestStatusItem = window.createStatusBarItem(0, { progress: true })
    this.codeActions = new CodeActions(nvim, this)
    this.format = new Format(nvim, this)
    this.locations = new Locations(nvim, this)
    this.refactor = new Refactor(nvim, this)
    this.symbols = new Symbols(nvim, this)
    this.signature = new Signature(nvim, this)
    this.codeLens = new CodeLens(nvim)
    this.colors = new Colors(nvim, this)
    this.hover = new HoverHandler(nvim, this)
    this.documentHighlighter = new Highlights(nvim, this)
    this.semanticHighlighter = new SemanticTokensHighlights(nvim)
    this.disposables.push({
      dispose: () => {
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
    events.on(['CursorMoved', 'CursorMovedI', 'InsertEnter', 'InsertSnippet', 'InsertLeave'], () => {
      if (this.requestTokenSource) {
        this.requestTokenSource.cancel()
        this.requestTokenSource = null
      }
    }, null, this.disposables)
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

  public async getWordEdit(): Promise<WorkspaceEdit> {
    let { doc, position } = await this.getCurrentState()
    let range = doc.getWordRangeAtPosition(position)
    if (!range || emptyRange(range)) return null
    let curname = doc.textDocument.getText(range)
    if (languages.hasProvider('rename', doc.textDocument)) {
      await doc.synchronize()
      let requestTokenSource = new CancellationTokenSource()
      let res = await languages.prepareRename(doc.textDocument, position, requestTokenSource.token)
      if (res === false) return null
      let edit = await languages.provideRenameEdits(doc.textDocument, position, curname, requestTokenSource.token)
      if (edit) return edit
    }
    window.showMessage('Rename provider not found, extract word ranges from current buffer', 'more')
    let ranges = doc.getSymbolRanges(curname)
    return {
      changes: {
        [doc.uri]: ranges.map(r => ({ range: r, newText: curname }))
      }
    }
  }

  public async rename(newName?: string): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('rename', doc.textDocument)
    await doc.synchronize()
    let statusItem = this.requestStatusItem
    try {
      let token = (new CancellationTokenSource()).token
      let res = await languages.prepareRename(doc.textDocument, position, token)
      if (res === false) {
        statusItem.hide()
        window.showMessage('Invalid position for rename', 'warning')
        return false
      }
      if (token.isCancellationRequested) return false
      let curname: string
      if (!newName) {
        if (Range.is(res)) {
          curname = doc.textDocument.getText(res)
          await window.moveTo(res.start)
        } else if (res && typeof res.placeholder === 'string') {
          curname = res.placeholder
        } else {
          curname = await this.nvim.eval('expand("<cword>")') as string
        }
        newName = await window.requestInput('New name', curname)
      }
      if (!newName) {
        statusItem.hide()
        return false
      }
      let edit = await languages.provideRenameEdits(doc.textDocument, position, newName, token)
      if (token.isCancellationRequested) return false
      statusItem.hide()
      if (!edit) {
        window.showMessage('Invalid position for rename', 'warning')
        return false
      }
      await workspace.applyEdit(edit)
      if (workspace.isVim) this.nvim.command('redraw', true)
      return true
    } catch (e) {
      statusItem.hide()
      window.showMessage(`Error on rename: ${e.message}`, 'error')
      logger.error(e)
      return false
    }
  }

  /**
   * getCallHierarchy
   */
  public async getCallHierarchy(method: 'incoming' | 'outgoing'): Promise<boolean> {
    const { doc, position } = await this.getCurrentState()
    this.checkProvier('callHierarchy', doc.textDocument)
    await doc.synchronize()
    const res = await this.withRequestToken('Prepare Call hierarchy', token => {
      return languages.prepareCallHierarchy(doc.textDocument, position, token)
    }, false)
    if (!res) return false

    const calls: CallHierarchyItem[] = []
    const item = Array.isArray(res) ? res[0] : res
    if (method === 'incoming') {
      const incomings = await this.withRequestToken('incoming calls', token => {
        return languages.provideIncomingCalls(item, token)
      }, true)
      if (!incomings) return
      for (const call of incomings) {
        calls.push(call.from)
      }
    } else {
      const outgoings = await this.withRequestToken('outgoing calls', token => {
        return languages.provideOutgoingCalls(item, token)
      }, true)
      if (!outgoings) return
      for (const call of outgoings) {
        calls.push(call.to)
      }
    }
    if (!calls) return false

    // TODO: callHierarchy tree UI?
    const locations: Location[] = []
    for (const call of calls) {
      locations.push({ uri: call.uri, range: call.range })
    }
    await workspace.showLocations(locations)
    return true
  }

  public async runCommand(id?: string, ...args: any[]): Promise<any> {
    if (id) {
      await events.fire('Command', [id])
      let res = await commandManager.executeCommand(id, ...args)
      if (args.length == 0) {
        await commandManager.addRecent(id)
      }
      return res
    } else {
      await listManager.start(['commands'])
    }
  }

  public async fold(kind?: string): Promise<boolean> {
    let { doc, winid } = await this.getCurrentState()
    this.checkProvier('foldingRange', doc.textDocument)
    await doc.synchronize()
    let win = this.nvim.createWindow(winid)
    let [foldmethod, foldlevel] = await this.nvim.eval('[&foldmethod,&foldlevel]') as [string, string]
    if (foldmethod != 'manual') {
      window.showMessage('foldmethod option should be manual!', 'warning')
      return false
    }
    let ranges = await this.withRequestToken('folding range', token => {
      return languages.provideFoldingRanges(doc.textDocument, {}, token)
    }, true)
    if (!ranges) return false
    if (kind) ranges = ranges.filter(o => o.kind == kind)
    if (ranges.length) {
      ranges.sort((a, b) => b.startLine - a.startLine)
      this.nvim.pauseNotification()
      this.nvim.command('normal! zE', true)
      for (let range of ranges) {
        let { startLine, endLine } = range
        let cmd = `${startLine + 1}, ${endLine + 1}fold`
        this.nvim.command(cmd, true)
      }
      win.setOption('foldenable', true, true)
      win.setOption('foldlevel', foldlevel, true)
      if (workspace.isVim) this.nvim.command('redraw', true)
      await this.nvim.resumeNotification()
      return true
    }
    return false
  }

  public async semanticHighlights(): Promise<void> {
    let { doc } = await this.getCurrentState()
    if (!languages.hasProvider('semanticTokens', doc.textDocument)) return

    await doc.synchronize()
    await this.semanticHighlighter.doHighlight(doc.bufnr)
  }

  public async getSemanticHighlights(): Promise<Highlight[]> {
    const { doc } = await this.getCurrentState()
    if (!languages.hasProvider('semanticTokens', doc.textDocument)) return

    await doc.synchronize()
    return await this.semanticHighlighter.getHighlights(doc.bufnr)
  }

  public async links(): Promise<DocumentLink[]> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('documentLink', doc.textDocument)
    let links = await this.withRequestToken('links', token => {
      return languages.getDocumentLinks(doc.textDocument, token)
    })
    links = links || []
    let res: DocumentLink[] = []
    for (let link of links) {
      if (link.target) {
        res.push(link)
      } else {
        link = await languages.resolveDocumentLink(link)
        res.push(link)
      }
    }
    return links
  }

  public async openLink(): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('documentLink', doc.textDocument)
    let links = await this.withRequestToken('links', token => {
      return languages.getDocumentLinks(doc.textDocument, token)
    })
    if (!links || links.length == 0) return false
    for (let link of links) {
      if (positionInRange(position, link.range) == 0) {
        let { target } = link
        if (!target) {
          link = await languages.resolveDocumentLink(link)
          target = link.target
        }
        if (target) {
          await workspace.openResource(target)
          return true
        }
        return false
      }
    }
    return false
  }

  public async getCommands(): Promise<CommandItem[]> {
    let list = commandManager.commandList
    let res: CommandItem[] = []
    let { titles } = commandManager
    for (let item of list) {
      res.push({
        id: item.id,
        title: titles.get(item.id) || ''
      })
    }
    return res
  }

  public async getSelectionRanges(): Promise<SelectionRange[] | null> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('selectionRange', doc.textDocument)
    await doc.synchronize()
    let selectionRanges: SelectionRange[] = await this.withRequestToken('selection ranges', token => {
      return languages.getSelectionRanges(doc.textDocument, [position], token)
    })
    if (selectionRanges && selectionRanges.length) return selectionRanges
    return null
  }

  public async selectRange(visualmode: string, forward: boolean): Promise<void> {
    let { nvim } = this
    let { doc } = await this.getCurrentState()
    this.checkProvier('selectionRange', doc.textDocument)
    let positions: Position[] = []
    if (!forward && (!this.selectionRange || !visualmode)) return
    if (visualmode) {
      let range = await workspace.getSelectedRange(visualmode, doc)
      positions.push(range.start, range.end)
    } else {
      let position = await window.getCursorPosition()
      positions.push(position)
    }
    if (!forward) {
      let curr = Range.create(positions[0], positions[1])
      let { selectionRange } = this
      while (selectionRange && selectionRange.parent) {
        if (equals(selectionRange.parent.range, curr)) {
          break
        }
        selectionRange = selectionRange.parent
      }
      if (selectionRange && selectionRange.parent) {
        await workspace.selectRange(selectionRange.range)
      }
      return
    }
    await doc.synchronize()
    let selectionRanges: SelectionRange[] = await this.withRequestToken('selection ranges', token => {
      return languages.getSelectionRanges(doc.textDocument, positions, token)
    })
    if (!selectionRanges || selectionRanges.length == 0) return
    let mode = await nvim.eval('mode()')
    if (mode != 'n') await nvim.eval(`feedkeys("\\<Esc>", 'in')`)
    let selectionRange: SelectionRange
    if (selectionRanges.length == 1) {
      selectionRange = selectionRanges[0]
    } else if (positions.length > 1) {
      let r = Range.create(positions[0], positions[1])
      selectionRange = selectionRanges[0]
      while (selectionRange) {
        if (equals(r, selectionRange.range)) {
          selectionRange = selectionRange.parent
          continue
        }
        if (positionInRange(positions[1], selectionRange.range) == 0) {
          break
        }
        selectionRange = selectionRange.parent
      }
    }
    if (!selectionRange) return
    this.selectionRange = selectionRanges[0]
    await workspace.selectRange(selectionRange.range)
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

  public dispose(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
      this.requestTimer = undefined
    }
    disposeAll(this.disposables)
  }
}
