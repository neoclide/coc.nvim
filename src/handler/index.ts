import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, CodeActionContext, CodeActionKind, Definition, Disposable, DocumentLink, ExecuteCommandParams, ExecuteCommandRequest, Hover, Location, LocationLink, MarkedString, MarkupContent, Position, Range, SelectionRange, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commandManager from '../commands'
import diagnosticManager from '../diagnostic/manager'
import events from '../events'
import languages from '../languages'
import listManager from '../list/manager'
import Document from '../model/document'
import FloatFactory from '../model/floatFactory'
import { TextDocumentContentProvider } from '../provider'
import services from '../services'
import { CodeAction, Documentation, ProviderName, StatusBarItem, TagDefinition } from '../types'
import { disposeAll } from '../util'
import { equals } from '../util/object'
import { emptyRange, positionInRange } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import CodeLens from './codelens/index'
import Colors from './colors/index'
import Format from './format'
import { addDocument, isMarkdown, SymbolInfo, synchronizeDocument } from './helper'
import Highlights from './highlights'
import Refactor from './refactor/index'
import Signature from './signature'
import Symbols from './symbols'
const logger = require('../util/logger')('Handler')

interface CommandItem {
  id: string
  title: string
}

interface Preferences {
  hoverTarget: string
  previewAutoClose: boolean
  previewMaxHeight: number
  floatActions: boolean
}

export default class Handler {
  private preferences: Preferences
  private documentHighlighter: Highlights
  private colors: Colors
  private symbols: Symbols
  private hoverFactory: FloatFactory
  private signature: Signature
  private format: Format
  private refactor: Refactor
  private documentLines: string[] = []
  private codeLens: CodeLens
  private selectionRange: SelectionRange = null
  private requestStatusItem: StatusBarItem
  private requestTokenSource: CancellationTokenSource | undefined
  private requestTimer: NodeJS.Timer
  private disposables: Disposable[] = []

  constructor(private nvim: Neovim) {
    this.getPreferences()
    this.requestStatusItem = window.createStatusBarItem(0, { progress: true })
    workspace.onDidChangeConfiguration(() => {
      this.getPreferences()
    })
    this.refactor = new Refactor()
    this.hoverFactory = new FloatFactory(nvim)
    this.signature = new Signature(nvim)
    this.format = new Format(nvim)
    this.symbols = new Symbols(nvim)
    this.codeLens = new CodeLens(nvim)
    this.colors = new Colors(nvim)
    this.documentHighlighter = new Highlights(nvim)
    events.on(['CursorMoved', 'CursorMovedI', 'InsertEnter', 'InsertSnippet', 'InsertLeave'], () => {
      if (this.requestTokenSource) {
        this.requestTokenSource.cancel()
      }
    }, null, this.disposables)
    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async () => {
        nvim.pauseNotification()
        nvim.command('setlocal conceallevel=2 nospell nofoldenable wrap', true)
        nvim.command('setlocal bufhidden=wipe nobuflisted', true)
        nvim.command('setfiletype markdown', true)
        nvim.command(`if winnr('j') != winnr('k') | exe "normal! z${Math.min(this.documentLines.length, this.preferences.previewMaxHeight)}\\<cr> | endif"`, true)
        await nvim.resumeNotification()
        return this.documentLines.join('\n')
      }
    }
    this.disposables.push(workspace.registerTextDocumentContentProvider('coc', provider))
    this.disposables.push(commandManager.registerCommand('editor.action.pickColor', () => {
      return this.pickColor()
    }))
    commandManager.titles.set('editor.action.pickColor', 'pick color from system color picker when possible.')
    this.disposables.push(commandManager.registerCommand('editor.action.colorPresentation', () => {
      return this.pickPresentation()
    }))
    commandManager.titles.set('editor.action.colorPresentation', 'change color presentation.')
    this.disposables.push(commandManager.registerCommand('editor.action.organizeImport', async (bufnr?: number) => {
      await this.organizeImport(bufnr)
    }))
    commandManager.titles.set('editor.action.organizeImport', 'run organize import code action.')
  }

  public async organizeImport(bufnr?: number): Promise<void> {
    if (!bufnr) bufnr = await this.nvim.call('bufnr', ['%'])
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) throw new Error(`buffer ${bufnr} not attached`)
    await synchronizeDocument(doc)
    let actions = await this.getCodeActions(doc, undefined, [CodeActionKind.SourceOrganizeImports])
    if (actions && actions.length) {
      await this.applyCodeAction(actions[0])
      return
    }
    throw new Error('Organize import action not found.')
  }

  /**
   * Throw error when provider not exists.
   */
  private checkProvier(id: ProviderName, document: TextDocument): void {
    if (languages.hasProvider(id, document)) return
    throw new Error(`${id} provider not found for current buffer, your language server don't support it.`)
  }

  private async withRequestToken<T>(name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean): Promise<T | null> {
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

  public async getCurrentFunctionSymbol(): Promise<string> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('documentSymbol', doc.textDocument)
    return await this.symbols.getCurrentFunctionSymbol()
  }

  /*
   * supportedSymbols must be string values of symbolKind
   */
  public async selectSymbolRange(inner: boolean, visualmode: string, supportedSymbols: string[]): Promise<void> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('documentSymbol', doc.textDocument)
    return await this.symbols.selectSymbolRange(inner, visualmode, supportedSymbols)
  }

  public async getDocumentSymbols(bufnr: number): Promise<SymbolInfo[]> {
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) throw new Error(`buffer ${bufnr} not attached`)
    this.checkProvier('documentSymbol', doc.textDocument)
    return await this.symbols.getDocumentSymbols(bufnr)
  }

  public async hasProvider(id: string): Promise<boolean> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return false
    return languages.hasProvider(id as ProviderName, doc.textDocument)
  }

  public async onHover(hoverTarget?: string): Promise<boolean> {
    let { doc, position, winid } = await this.getCurrentState()
    this.checkProvier('hover', doc.textDocument)
    let target = hoverTarget ?? this.preferences.hoverTarget
    if (target == 'float') {
      this.hoverFactory.close()
    }
    await synchronizeDocument(doc)
    let hovers = await this.withRequestToken<Hover[]>('hover', token => {
      return languages.getHover(doc.textDocument, position, token)
    }, true)
    if (hovers == null) return false
    let hover = hovers.find(o => Range.is(o.range))
    if (hover?.range) {
      let win = this.nvim.createWindow(winid)
      let ids = await win.highlightRanges('CocHoverRange', [hover.range], 99) as number[]
      setTimeout(() => {
        if (ids.length) win.clearMatches(ids)
        if (workspace.isVim) this.nvim.command('redraw', true)
      }, 1000)
    }
    await this.previewHover(hovers, target)
    return true
  }

  /**
   * Get hover text array
   */
  public async getHover(): Promise<string[]> {
    let result: string[] = []
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('hover', doc.textDocument)
    await synchronizeDocument(doc)
    let tokenSource = new CancellationTokenSource()
    let hovers = await languages.getHover(doc.textDocument, position, tokenSource.token)
    if (Array.isArray(hovers)) {
      for (let h of hovers) {
        let { contents } = h
        if (Array.isArray(contents)) {
          contents.forEach(c => {
            result.push(typeof c === 'string' ? c : c.value)
          })
        } else if (MarkupContent.is(contents)) {
          result.push(contents.value)
        } else {
          result.push(typeof contents === 'string' ? contents : contents.value)
        }
      }
    }
    result = result.filter(s => s != null && s.length > 0)
    return result
  }

  public async gotoDefinition(openCommand?: string): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('definition', doc.textDocument)
    await synchronizeDocument(doc)
    let definition = await this.withRequestToken('definition', token => {
      return languages.getDefinition(doc.textDocument, position, token)
    }, true)
    if (definition == null) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoDeclaration(openCommand?: string): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('declaration', doc.textDocument)
    await synchronizeDocument(doc)
    let definition = await this.withRequestToken('declaration', token => {
      return languages.getDeclaration(doc.textDocument, position, token)
    }, true)
    if (definition == null) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoTypeDefinition(openCommand?: string): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('typeDefinition', doc.textDocument)
    await synchronizeDocument(doc)
    let definition = await this.withRequestToken('type definition', token => {
      return languages.getTypeDefinition(doc.textDocument, position, token)
    }, true)
    if (definition == null) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoImplementation(openCommand?: string): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('implementation', doc.textDocument)
    await synchronizeDocument(doc)
    let definition = await this.withRequestToken('implementation', token => {
      return languages.getImplementation(doc.textDocument, position, token)
    }, true)
    if (definition == null) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async gotoReferences(openCommand?: string, includeDeclaration = true): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('reference', doc.textDocument)
    await synchronizeDocument(doc)
    let definition = await this.withRequestToken('references', token => {
      return languages.getReferences(doc.textDocument, { includeDeclaration }, position, token)
    }, true)
    if (definition == null) return false
    await this.handleLocations(definition, openCommand)
    return true
  }

  public async getWordEdit(): Promise<WorkspaceEdit> {
    let { doc, position } = await this.getCurrentState()
    let range = doc.getWordRangeAtPosition(position)
    if (!range || emptyRange(range)) return null
    let curname = doc.textDocument.getText(range)
    if (languages.hasProvider('rename', doc.textDocument)) {
      await synchronizeDocument(doc)
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
    await synchronizeDocument(doc)
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
      return true
    } catch (e) {
      statusItem.hide()
      window.showMessage(`Error on rename: ${e.message}`, 'error')
      logger.error(e)
      return false
    }
  }

  public async documentFormatting(): Promise<boolean> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('format', doc.textDocument)
    return await this.format.documentFormat(doc)
  }

  public async documentRangeFormatting(mode: string): Promise<number> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('formatRange', doc.textDocument)
    return await this.format.documentRangeFormat(doc, mode)
  }

  public async getTagList(): Promise<TagDefinition[] | null> {
    let { doc, position } = await this.getCurrentState()
    let word = await this.nvim.call('expand', '<cword>')
    if (!word) return null
    if (!languages.hasProvider('definition', doc.textDocument)) return null
    let tokenSource = new CancellationTokenSource()
    let definitions = await languages.getDefinition(doc.textDocument, position, tokenSource.token)
    if (!definitions || !definitions.length) return null
    return definitions.map(location => {
      let parsedURI = URI.parse(location.uri)
      const filename = parsedURI.scheme == 'file' ? parsedURI.fsPath : parsedURI.toString()
      return {
        name: word,
        cmd: `keepjumps ${location.range.start.line + 1} | normal ${location.range.start.character + 1}|`,
        filename,
      }
    })
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

  public async getCodeActions(doc: Document, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]> {
    range = range || Range.create(0, 0, doc.lineCount, 0)
    let diagnostics = diagnosticManager.getDiagnosticsInRange(doc.textDocument, range)
    let context: CodeActionContext = { diagnostics }
    if (only && Array.isArray(only)) context.only = only
    let codeActions = await this.withRequestToken('code action', token => {
      return languages.getCodeActions(doc.textDocument, range, context, token)
    })
    if (!codeActions || codeActions.length == 0) return []
    codeActions.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) {
        return -1
      }
      if (b.isPreferred && !a.isPreferred) {
        return 1
      }
      return 0
    })
    return codeActions
  }

  public async doCodeAction(mode: string | null, only?: CodeActionKind[] | string): Promise<void> {
    let { doc } = await this.getCurrentState()
    let range: Range
    if (mode) range = await workspace.getSelectedRange(mode, doc)
    await synchronizeDocument(doc)
    let codeActions = await this.getCodeActions(doc, range, Array.isArray(only) ? only : null)
    if (only && typeof only == 'string') {
      codeActions = codeActions.filter(o => o.title == only || (o.command && o.command.title == only))
      if (codeActions.length == 1) {
        await this.applyCodeAction(codeActions[0])
        return
      }
    }
    if (!codeActions || codeActions.length == 0) {
      window.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }

    let idx = this.preferences.floatActions
      ? await window.showMenuPicker(
        codeActions.map(o => o.title),
        "Choose action"
      )
      : await window.showQuickpick(codeActions.map(o => o.title))
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Get current codeActions
   */
  public async getCurrentCodeActions(mode?: string, only?: CodeActionKind[]): Promise<CodeAction[]> {
    let { doc } = await this.getCurrentState()
    let range: Range
    if (mode) range = await workspace.getSelectedRange(mode, doc)
    return await this.getCodeActions(doc, range, only)
  }

  /**
   * Invoke preferred quickfix at current position, return false when failed
   */
  public async doQuickfix(): Promise<boolean> {
    let actions = await this.getCurrentCodeActions('n', [CodeActionKind.QuickFix])
    if (!actions || actions.length == 0) {
      window.showMessage('No quickfix action available', 'warning')
      return false
    }
    await this.applyCodeAction(actions[0])
    await this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-fix-current)", -1)`)
    return true
  }

  public async applyCodeAction(action: CodeAction): Promise<void> {
    let { command, edit } = action
    if (edit) await workspace.applyEdit(edit)
    if (command) {
      if (commandManager.has(command.command)) {
        commandManager.execute(command)
      } else {
        let clientId = action.clientId
        let service = services.getService(clientId)
        let params: ExecuteCommandParams = {
          command: command.command,
          arguments: command.arguments
        }
        if (service.client) {
          let { client } = service
          client
            .sendRequest(ExecuteCommandRequest.type, params)
            .then(undefined, error => {
              window.showMessage(`Execute '${command.command} error: ${error}'`, 'error')
            })
        }
      }
    }
  }

  public async doCodeLensAction(): Promise<void> {
    await this.codeLens.doAction()
  }

  public async fold(kind?: string): Promise<boolean> {
    let { doc, winid } = await this.getCurrentState()
    this.checkProvier('foldingRange', doc.textDocument)
    await synchronizeDocument(doc)
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

  public async pickColor(): Promise<void> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('documentColor', doc.textDocument)
    await this.colors.pickColor()
  }

  public async pickPresentation(): Promise<void> {
    let { doc } = await this.getCurrentState()
    this.checkProvier('documentColor', doc.textDocument)
    await this.colors.pickPresentation()
  }

  public async highlight(): Promise<void> {
    await this.documentHighlighter.highlight()
  }

  public async getSymbolsRanges(): Promise<Range[]> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('documentHighlight', doc.textDocument)
    let highlights = await this.documentHighlighter.getHighlights(doc, position)
    if (!highlights) return null
    return highlights.map(o => o.range)
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
      if (positionInRange(position, link.range)) {
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

  public async showSignatureHelp(): Promise<boolean> {
    let { doc, position } = await this.getCurrentState()
    if (!languages.hasProvider('signature', doc.textDocument)) return false
    return await this.signature.triggerSignatureHelp(doc, position)
  }

  /**
   * Send custom request for locations to services.
   */
  public async findLocations(id: string, method: string, params: any, openCommand?: string | false): Promise<void> {
    let { doc, position } = await this.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: doc.uri },
      position
    })
    let res: any = await services.sendRequest(id, method, params)
    res = res || []
    let locations: Location[] = []
    if (Array.isArray(res)) {
      locations = res as Location[]
    } else if (res.hasOwnProperty('location') && res.hasOwnProperty('children')) {
      let getLocation = (item: any): void => {
        locations.push(item.location as Location)
        if (item.children && item.children.length) {
          for (let loc of item.children) {
            getLocation(loc)
          }
        }
      }
      getLocation(res)
    }
    await this.handleLocations(locations, openCommand)
  }

  public async handleLocations(definition: Definition | LocationLink[], openCommand?: string | false): Promise<void> {
    if (!definition) return
    let locations: Location[] = Array.isArray(definition) ? definition as Location[] : [definition]
    let len = locations.length
    if (len == 0) return
    if (len == 1 && openCommand !== false) {
      let location = definition[0] as Location
      if (LocationLink.is(definition[0])) {
        let link = definition[0]
        location = Location.create(link.targetUri, link.targetRange)
      }
      let { uri, range } = location
      await workspace.jumpTo(uri, range.start, openCommand)
    } else {
      await workspace.showLocations(definition as Location[])
    }
  }

  public async getSelectionRanges(): Promise<SelectionRange[] | null> {
    let { doc, position } = await this.getCurrentState()
    this.checkProvier('selectionRange', doc.textDocument)
    await synchronizeDocument(doc)
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
    await synchronizeDocument(doc)
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

  public async codeActionRange(start: number, end: number, only?: string): Promise<void> {
    let { doc } = await this.getCurrentState()
    await synchronizeDocument(doc)
    let line = doc.getline(end - 1)
    let range = Range.create(start - 1, 0, end - 1, line.length)
    let codeActions = await this.getCodeActions(doc, range, only ? [only] : null)
    if (!codeActions || codeActions.length == 0) {
      window.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }
    let idx = await window.showMenuPicker(codeActions.map(o => o.title), 'Choose action')
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Refactor of current symbol
   */
  public async doRefactor(): Promise<void> {
    let { doc, position } = await this.getCurrentState()
    await synchronizeDocument(doc)
    let edit = await this.withRequestToken<WorkspaceEdit>('refactor', async token => {
      let res = await languages.prepareRename(doc.textDocument, position, token)
      if (token.isCancellationRequested) return null
      if (res === false) {
        window.showMessage('Invalid position', 'warning')
        return null
      }
      let edit = await languages.provideRenameEdits(doc.textDocument, position, 'NewName', token)
      if (token.isCancellationRequested) return null
      if (!edit) {
        window.showMessage('Empty workspaceEdit from language server', 'warning')
        return null
      }
      return edit
    })
    if (edit) {
      await this.refactor.fromWorkspaceEdit(edit, doc.filetype)
    }
  }

  public async saveRefactor(bufnr: number): Promise<void> {
    await this.refactor.save(bufnr)
  }

  public async search(args: string[]): Promise<void> {
    await this.refactor.search(args)
  }

  private async previewHover(hovers: Hover[], target: string): Promise<void> {
    let docs: Documentation[] = []
    let isPreview = target === 'preview'
    for (let hover of hovers) {
      let { contents } = hover
      if (Array.isArray(contents)) {
        for (let item of contents) {
          if (typeof item === 'string') {
            addDocument(docs, item, 'markdown', isPreview)
          } else {
            addDocument(docs, item.value, item.language, isPreview)
          }
        }
      } else if (MarkedString.is(contents)) {
        if (typeof contents == 'string') {
          addDocument(docs, contents, 'markdown', isPreview)
        } else {
          addDocument(docs, contents.value, contents.language, isPreview)
        }
      } else if (MarkupContent.is(contents)) {
        addDocument(docs, contents.value, isMarkdown(contents) ? 'markdown' : 'txt', isPreview)
      }
    }
    if (target == 'float') {
      await this.hoverFactory.show(docs, { modes: ['n'] })
      return
    }
    let lines = docs.reduce((p, c) => {
      let arr = c.content.split(/\r?\n/)
      if (p.length > 0) p.push('')
      p.push(...arr)
      return p
    }, [])
    if (target == 'echo') {
      const msg = lines.join('\n').trim()
      if (msg.length) {
        await this.nvim.call('coc#util#echo_hover', msg)
      }
    } else {
      this.documentLines = lines
      await this.nvim.command(`noswapfile pedit coc://document`)
    }
  }

  private getPreferences(): void {
    let config = workspace.getConfiguration('coc.preferences')
    let hoverTarget = config.get<string>('hoverTarget', 'float')
    if (hoverTarget == 'float' && !workspace.floatSupported) {
      hoverTarget = 'preview'
    }
    this.preferences = {
      hoverTarget,
      previewMaxHeight: config.get<number>('previewMaxHeight', 12),
      previewAutoClose: config.get<boolean>('previewAutoClose', false),
      floatActions: config.get<boolean>('floatActions', true)
    }
  }

  private async getCurrentState(): Promise<{
    doc: Document
    position: Position
    winid: number
  }> {
    let { nvim } = this
    let [bufnr, [line, character], winid] = await nvim.eval("[bufnr('%'),coc#util#cursor(),win_getid()]") as [number, [number, number], number]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) throw new Error(`current buffer ${bufnr} not attached`)
    return {
      doc,
      position: Position.create(line, character),
      winid
    }
  }

  public dispose(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer)
      this.requestTimer = undefined
    }
    this.refactor.dispose()
    this.signature.dispose()
    this.symbols.dispose()
    this.hoverFactory.dispose()
    this.colors.dispose()
    this.format.dispose()
    this.documentHighlighter.dispose()
    disposeAll(this.disposables)
  }
}
