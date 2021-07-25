import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import matchAll from 'string.prototype.matchall'
import { CallHierarchyItem, CodeAction, CodeActionKind } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commandManager from './commands'
import completion from './completion'
import Cursors from './cursors'
import diagnosticManager from './diagnostic/manager'
import events from './events'
import extensions from './extensions'
import Handler from './handler'
import languages from './languages'
import listManager from './list/manager'
import services from './services'
import snippetManager from './snippets/manager'
import sources from './sources'
import { OutputChannel, PatternType } from './types'
import window from './window'
import workspace from './workspace'
const logger = require('./util/logger')('plugin')
matchAll.shim()

declare const REVISION

export default class Plugin extends EventEmitter {
  private _ready = false
  private handler: Handler | undefined
  private infoChannel: OutputChannel
  private cursors: Cursors
  private actions: Map<string, Function> = new Map()

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    workspace.onDidChangeWorkspaceFolders(() => {
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
    })
    this.cursors = new Cursors(nvim)
    commandManager.init(nvim, this)
    this.addAction('checkJsonExtension', () => {
      if (extensions.has('coc-json')) return
      window.showMessage(`Run :CocInstall coc-json for json intellisense`, 'more')
    })
    this.addAction('rootPatterns', bufnr => {
      let doc = workspace.getDocument(bufnr)
      if (!doc) return null
      return {
        buffer: workspace.getRootPatterns(doc, PatternType.Buffer),
        server: workspace.getRootPatterns(doc, PatternType.LanguageServer),
        global: workspace.getRootPatterns(doc, PatternType.Global)
      }
    })
    this.addAction('getConfig', async key => {
      let document = await workspace.document
      return workspace.getConfiguration(key, document ? document.uri : undefined)
    })
    this.addAction('doAutocmd', async (id: number, ...args: []) => {
      let autocmd = (workspace as any).autocmds.get(id) as any
      if (autocmd) {
        try {
          await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
        } catch (e) {
          logger.error(`Error on autocmd ${autocmd.event}`, e)
          window.showMessage(`Error on autocmd ${autocmd.event}: ${e.message}`)
        }
      }
    })
    this.addAction('openLog', async () => {
      let file = logger.getLogFile()
      await workspace.jumpTo(URI.file(file).toString())
    })
    this.addAction('attach', () => workspace.attach())
    this.addAction('detach', () => workspace.detach())
    this.addAction('doKeymap', async (key: string, defaultReturn = '', pressed?: string) => {
      let keymap = workspace.keymaps.get(key)
      if (!keymap) {
        logger.error(`keymap for ${key} not found`)
        this.nvim.command(`silent! unmap <buffer> ${pressed.startsWith('{') && pressed.endsWith('}') ? `<${pressed.slice(1, -1)}>` : pressed}`, true)
        return defaultReturn
      }
      let [fn, repeat] = keymap
      let res = await Promise.resolve(fn())
      if (repeat) await nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`)
      return res ?? defaultReturn
    })
    this.addAction('registExtensions', async (...folders: string[]) => {
      for (let folder of folders) {
        await extensions.loadExtension(folder)
      }
    })
    this.addAction('snippetCheck', async (checkExpand: boolean, checkJump: boolean) => {
      if (checkExpand && !extensions.has('coc-snippets')) {
        console.error('coc-snippets required for check expand status!')
        return false
      }
      if (checkJump) {
        let jumpable = snippetManager.jumpable()
        if (jumpable) return true
      }
      if (checkExpand) {
        let api = extensions.getExtensionApi('coc-snippets') as any
        if (api && api.hasOwnProperty('expandable')) {
          let expandable = await Promise.resolve(api.expandable())
          if (expandable) return true
        }
      }
      return false
    })
    this.addAction('snippetNext', () => snippetManager.nextPlaceholder())
    this.addAction('snippetPrev', () => snippetManager.previousPlaceholder())
    this.addAction('snippetCancel', () => snippetManager.cancel())
    this.addAction('openLocalConfig', () => window.openLocalConfig())
    this.addAction('showInfo', async () => {
      if (!this.infoChannel) {
        this.infoChannel = window.createOutputChannel('info')
      } else {
        this.infoChannel.clear()
      }
      let channel = this.infoChannel
      channel.appendLine('## versions')
      channel.appendLine('')
      let out = await this.nvim.call('execute', ['version']) as string
      let first = out.trim().split(/\r?\n/, 2)[0].replace(/\(.*\)/, '').trim()
      channel.appendLine('vim version: ' + first + `${workspace.isVim ? ' ' + workspace.env.version : ''}`)
      channel.appendLine('node version: ' + process.version)
      channel.appendLine('coc.nvim version: ' + this.version)
      channel.appendLine('coc.nvim directory: ' + path.dirname(__dirname))
      channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM))
      channel.appendLine('platform: ' + process.platform)
      channel.appendLine('')
      channel.appendLine('## Log of coc.nvim')
      channel.appendLine('')
      let file = logger.getLogFile()
      if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, { encoding: 'utf8' })
        channel.appendLine(content)
      }
      channel.show()
    })
    this.addAction('findLocations', (id: string, method: string, params: any, openCommand?: string | false) => {
      return this.handler.locations.findLocations(id, method, params, openCommand)
    })
    this.addAction('hasProvider', id => this.handler.hasProvider(id))
    this.addAction('getTagList', () => this.handler.locations.getTagList())
    this.addAction('hasSelected', () => completion.hasSelected())
    this.addAction('listNames', () => listManager.names)
    this.addAction('listDescriptions', () => listManager.descriptions)
    this.addAction('listLoadItems', name => listManager.loadItems(name))
    this.addAction('search', (...args: string[]) => this.handler.refactor.search(args))
    this.addAction('cursorsSelect', (bufnr: number, kind: string, mode: string) => this.cursors.select(bufnr, kind, mode))
    this.addAction('fillDiagnostics', (bufnr: number) => diagnosticManager.setLocationlist(bufnr))
    this.addAction('saveRefactor', bufnr => this.handler.refactor.save(bufnr))
    this.addAction('commandList', () => this.handler.commands.getCommandList())
    this.addAction('selectSymbolRange', (inner: boolean, visualmode: string, supportedSymbols: string[]) => this.handler.symbols.selectSymbolRange(inner, visualmode, supportedSymbols))
    this.addAction('openList', (...args: string[]) => listManager.start(args))
    this.addAction('listResume', (name?: string) => listManager.resume(name))
    this.addAction('listCancel', () => listManager.cancel(true))
    this.addAction('listPrev', (name?: string) => listManager.previous(name))
    this.addAction('listNext', (name?: string) => listManager.next(name))
    this.addAction('listFirst', (name?: string) => listManager.first(name))
    this.addAction('listLast', (name?: string) => listManager.last(name))
    this.addAction('sendRequest', (id: string, method: string, params?: any) => services.sendRequest(id, method, params))
    this.addAction('sendNotification', (id: string, method: string, params?: any) => services.sendNotification(id, method, params))
    this.addAction('registNotification', (id: string, method: string) => services.registNotification(id, method))
    this.addAction('updateConfig', (section: string, val: any) => workspace.configurations.updateUserConfig({ [section]: val }))
    this.addAction('links', () => this.handler.links.getLinks())
    this.addAction('openLink', () => this.handler.links.openCurrentLink())
    this.addAction('pickColor', () => this.handler.colors.pickColor())
    this.addAction('colorPresentation', () => this.handler.colors.pickPresentation())
    this.addAction('highlight', () => this.handler.documentHighlighter.highlight())
    this.addAction('fold', (kind?: string) => this.handler.fold.fold(kind))
    this.addAction('startCompletion', option => completion.startCompletion(option))
    this.addAction('stopCompletion', () => completion.stop(false))
    this.addAction('sourceStat', () => sources.sourceStats())
    this.addAction('refreshSource', name => sources.refresh(name))
    this.addAction('toggleSource', name => sources.toggleSource(name))
    this.addAction('diagnosticRefresh', bufnr => diagnosticManager.refresh(bufnr))
    this.addAction('diagnosticInfo', () => diagnosticManager.echoMessage())
    this.addAction('diagnosticToggle', () => diagnosticManager.toggleDiagnostic())
    this.addAction('diagnosticToggleBuffer', async (bufnr?: number) => {
      if (!bufnr) bufnr = await nvim.call('bufnr', ['%'])
      diagnosticManager.toggleDiagnosticBuffer(bufnr)
    })
    this.addAction('diagnosticNext', severity => diagnosticManager.jumpNext(severity))
    this.addAction('diagnosticPrevious', severity => diagnosticManager.jumpPrevious(severity))
    this.addAction('diagnosticPreview', () => diagnosticManager.preview())
    this.addAction('diagnosticList', () => diagnosticManager.getDiagnosticList())
    this.addAction('jumpDefinition', openCommand => this.handler.locations.gotoDefinition(openCommand))
    this.addAction('definitions', () => this.handler.locations.definitions())
    this.addAction('jumpDeclaration', openCommand => this.handler.locations.gotoDeclaration(openCommand))
    this.addAction('declarations', () => this.handler.locations.declarations())
    this.addAction('jumpImplementation', openCommand => this.handler.locations.gotoImplementation(openCommand))
    this.addAction('implementations', () => this.handler.locations.implementations())
    this.addAction('jumpTypeDefinition', openCommand => this.handler.locations.gotoTypeDefinition(openCommand))
    this.addAction('typeDefinitions', () => this.handler.locations.typeDefinitions())
    this.addAction('jumpReferences', openCommand => this.handler.locations.gotoReferences(openCommand))
    this.addAction('references', () => this.handler.locations.references())
    this.addAction('jumpUsed', openCommand => this.handler.locations.gotoReferences(openCommand, false))
    this.addAction('doHover', hoverTarget => this.handler.hover.onHover(hoverTarget))
    this.addAction('getHover', () => this.handler.hover.getHover())
    this.addAction('showSignatureHelp', () => this.handler.signature.triggerSignatureHelp())
    this.addAction('documentSymbols', async (bufnr?: number) => {
      if (!bufnr) {
        let doc = await workspace.document
        bufnr = doc.bufnr
      }
      return await this.handler.symbols.getDocumentSymbols(bufnr)
    })
    this.addAction('ensureDocument', async () => {
      let doc = await workspace.document
      return doc && doc.attached
    })
    this.addAction('symbolRanges', () => this.handler.documentHighlighter.getSymbolsRanges())
    this.addAction('selectionRanges', () => this.handler.selectionRange.getSelectionRanges())
    this.addAction('rangeSelect', (visualmode, forward) => this.handler.selectionRange.selectRange(visualmode, forward))
    this.addAction('rename', newName => this.handler.rename.rename(newName))
    this.addAction('getWorkspaceSymbols', input => this.handler.symbols.getWorkspaceSymbols(input))
    this.addAction('resolveWorkspaceSymbol', symbolInfo => this.handler.symbols.resolveWorkspaceSymbol(symbolInfo))
    this.addAction('formatSelected', mode => this.handler.format.formatCurrentRange(mode))
    this.addAction('format', () => this.handler.format.formatCurrentBuffer())
    this.addAction('commands', () => this.handler.commands.getCommands())
    this.addAction('services', () => services.getServiceStats())
    this.addAction('toggleService', name => services.toggle(name))
    this.addAction('codeAction', (mode, only) => this.handler.codeActions.doCodeAction(mode, only))
    this.addAction('organizeImport', () => this.handler.codeActions.organizeImport())
    this.addAction('fixAll', () => this.handler.codeActions.doCodeAction(null, [CodeActionKind.SourceFixAll]))
    // save actions send to vim, for provider resolve
    let codeActions: CodeAction[] = []
    this.addAction('doCodeAction', codeAction => {
      if (codeAction.index == null) {
        throw new Error(`index should exists with codeAction`)
      }
      let action = codeActions[codeAction.index]
      if (!action) throw new Error(`invalid codeAction index: ${codeAction.index}`)
      return this.handler.codeActions.applyCodeAction(action)
    })
    this.addAction('codeActions', async (mode, only) => {
      codeActions = await this.handler.codeActions.getCurrentCodeActions(mode, only)
      // save index for retreive
      return codeActions.map((o, idx) => Object.assign({ index: idx }, o))
    })
    this.addAction('quickfixes', async mode => {
      codeActions = await this.handler.codeActions.getCurrentCodeActions(mode, [CodeActionKind.QuickFix])
      return codeActions.map((o, idx) => Object.assign({ index: idx }, o))
    })
    this.addAction('codeLensAction', () => this.handler.codeLens.doAction())
    this.addAction('runCommand', (...args: any[]) => this.handler.commands.runCommand(...args))
    this.addAction('doQuickfix', () => this.handler.codeActions.doQuickfix())
    this.addAction('refactor', () => this.handler.refactor.doRefactor())
    this.addAction('repeatCommand', () => this.handler.commands.repeat())
    this.addAction('installExtensions', (...list: string[]) => extensions.installExtensions(list))
    this.addAction('updateExtensions', sync => extensions.updateExtensions(sync))
    this.addAction('extensionStats', () => extensions.getExtensionStates())
    this.addAction('loadedExtensions', () => extensions.loadedExtensions())
    this.addAction('watchExtension', (id: string) => extensions.watchExtension(id))
    this.addAction('activeExtension', name => extensions.activate(name))
    this.addAction('deactivateExtension', name => extensions.deactivate(name))
    this.addAction('reloadExtension', name => extensions.reloadExtension(name))
    this.addAction('toggleExtension', name => extensions.toggleExtension(name))
    this.addAction('uninstallExtension', (...args: string[]) => extensions.uninstallExtension(args))
    this.addAction('getCurrentFunctionSymbol', () => this.handler.symbols.getCurrentFunctionSymbol())
    this.addAction('showOutline', (keep?: number) => this.handler.symbols.showOutline(keep))
    this.addAction('hideOutline', () => this.handler.symbols.hideOutline())
    this.addAction('getWordEdit', () => this.handler.rename.getWordEdit())
    this.addAction('addCommand', cmd => this.handler.commands.addVimCommand(cmd))
    this.addAction('addRanges', ranges => this.cursors.addRanges(ranges))
    this.addAction('currentWorkspacePath', () => workspace.rootPath)
    this.addAction('selectCurrentPlaceholder', triggerAutocmd => snippetManager.selectCurrentPlaceholder(!!triggerAutocmd))
    this.addAction('codeActionRange', (start, end, only) => this.handler.codeActions.codeActionRange(start, end, only))
    this.addAction('incomingCalls', (item?: CallHierarchyItem) => this.handler.callHierarchy.getIncoming(item))
    this.addAction('outgoingCalls', (item?: CallHierarchyItem) => this.handler.callHierarchy.getOutgoing(item))
    this.addAction('semanticHighlight', () => this.handler.semanticHighlighter.highlightCurrent())
    this.addAction('showSemanticHighlightInfo', () => this.handler.semanticHighlighter.showHiglightInfo())
  }

  private addAction(key: string, fn: Function): void {
    if (this.actions.has(key)) {
      throw new Error(`Action ${key} already exists`)
    }
    this.actions.set(key, fn)
  }

  public async init(): Promise<void> {
    let { nvim } = this
    let s = Date.now()
    try {
      await extensions.init()
      await workspace.init()
      languages.init()
      snippetManager.init()
      completion.init()
      diagnosticManager.init()
      listManager.init(nvim)
      sources.init()
      this.handler = new Handler(nvim)
      services.init()
      extensions.activateExtensions()
      workspace.setupDynamicAutocmd(true)
      nvim.pauseNotification()
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
      nvim.setVar('coc_service_initialized', 1, true)
      nvim.call('coc#util#do_autocmd', ['CocNvimInit'], true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
      this._ready = true
      await events.fire('ready', [])
      logger.info(`coc.nvim ${this.version} initialized with node: ${process.version} after ${Date.now() - s}ms`)
      this.emit('ready')
    } catch (e) {
      console.error(`Error on initialize: ${e.stack}`)
      logger.error(e.stack)
    }
  }

  public get isReady(): boolean {
    return this._ready
  }

  public get ready(): Promise<void> {
    if (this._ready) return Promise.resolve()
    return new Promise<void>(resolve => {
      this.once('ready', () => {
        resolve()
      })
    })
  }

  private get version(): string {
    return workspace.version + (typeof REVISION === 'string' ? '-' + REVISION : '')
  }

  public hasAction(method: string): boolean {
    return this.actions.has(method)
  }

  public async cocAction(method: string, ...args: any[]): Promise<any> {
    let fn = this.actions.get(method)
    if (!fn) throw new Error(`Action "${method}" not exists`)
    let ts = Date.now()
    let res = await Promise.resolve(fn.apply(null, args))
    let dt = Date.now() - ts
    if (dt > 500) logger.warn(`Slow action "${method}" cost ${dt}ms`)
    return res
  }

  public getHandler(): any {
    return this.handler
  }

  public dispose(): void {
    this.removeAllListeners()
    extensions.dispose()
    listManager.dispose()
    workspace.dispose()
    window.dispose()
    sources.dispose()
    services.stopAll()
    services.dispose()
    if (this.handler) {
      this.handler.dispose()
    }
    snippetManager.dispose()
    commandManager.dispose()
    completion.dispose()
    diagnosticManager.dispose()
  }
}
