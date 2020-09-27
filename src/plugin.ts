import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import path from 'path'
import { CancellationTokenSource, CodeActionKind } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commandManager from './commands'
import completion from './completion'
import Cursors from './cursors'
import diagnosticManager from './diagnostic/manager'
import extensions from './extensions'
import Handler from './handler'
import languages from './languages'
import listManager from './list/manager'
import services from './services'
import snippetManager from './snippets/manager'
import sources from './sources'
import { Autocmd, OutputChannel, PatternType } from './types'
import { CONFIG_FILE_NAME } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private _ready = false
  private handler: Handler
  private infoChannel: OutputChannel
  private cursors: Cursors
  private actions: Map<string, Function> = new Map()

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    this.cursors = new Cursors(nvim)
    this.addAction('hasProvider', (id: string) => this.handler.hasProvider(id))
    this.addAction('getTagList', async () => await this.handler.getTagList())
    this.addAction('hasSelected', () => completion.hasSelected())
    this.addAction('listNames', () => listManager.names)
    this.addAction('listDescriptions', () => listManager.descriptions)
    this.addAction('listLoadItems', async (name: string) => await listManager.loadItems(name))
    this.addAction('search', (...args: string[]) => this.handler.search(args))
    this.addAction('cursorsSelect', (bufnr: number, kind: string, mode: string) => this.cursors.select(bufnr, kind, mode))
    this.addAction('fillDiagnostics', (bufnr: number) => diagnosticManager.setLocationlist(bufnr))
    this.addAction('getConfig', async key => {
      let document = await workspace.document
      // eslint-disable-next-line id-blacklist
      return workspace.getConfiguration(key, document ? document.uri : undefined)
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
    this.addAction('installExtensions', async (...list: string[]) => {
      await extensions.installExtensions(list)
    })
    this.addAction('saveRefactor', async (bufnr: number) => {
      await this.handler.saveRefactor(bufnr)
    })
    this.addAction('updateExtensions', async (sync?: boolean) => {
      await extensions.updateExtensions(sync)
    })
    this.addAction('commandList', () => commandManager.commandList.map(o => o.id))
    this.addAction('openList', async (...args: string[]) => {
      await this.ready
      await listManager.start(args)
    })
    this.addAction('selectSymbolRange', (inner: boolean, visualmode: string, supportedSymbols: string[]) => this.handler.selectSymbolRange(inner, visualmode, supportedSymbols))
    this.addAction('listResume', (name?: string) => listManager.resume(name))
    this.addAction('listPrev', (name?: string) => listManager.previous(name))
    this.addAction('listNext', (name?: string) => listManager.next(name))
    this.addAction('listFirst', (name?: string) => listManager.first(name))
    this.addAction('listLast', (name?: string) => listManager.last(name))
    this.addAction('sendRequest', (id: string, method: string, params?: any) => services.sendRequest(id, method, params))
    this.addAction('sendNotification', (id: string, method: string, params?: any) => {
      return services.sendNotification(id, method, params)
    })
    this.addAction('registNotification', (id: string, method: string) => {
      return services.registNotification(id, method)
    })
    this.addAction('doAutocmd', async (id: number, ...args: []) => {
      let autocmd = (workspace as any).autocmds.get(id) as Autocmd
      if (autocmd) {
        try {
          await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
        } catch (e) {
          logger.error(`Error on autocmd ${autocmd.event}`, e)
          workspace.showMessage(`Error on autocmd ${autocmd.event}: ${e.message}`)
        }
      }
    })
    this.addAction('updateConfig', (section: string, val: any) => {
      workspace.configurations.updateUserConfig({ [section]: val })
    })
    this.addAction('snippetNext', async () => {
      await snippetManager.nextPlaceholder()
      return ''
    })
    this.addAction('snippetPrev', async () => {
      await snippetManager.previousPlaceholder()
      return ''
    })
    this.addAction('snippetCancel', () => {
      snippetManager.cancel()
    })
    this.addAction('openLocalConfig', async () => {
      await workspace.openLocalConfig()
    })
    this.addAction('openLog', async () => {
      let file = logger.getLogFile()
      await workspace.jumpTo(URI.file(file).toString())
    })
    this.addAction('attach', () => {
      return workspace.attach()
    })
    this.addAction('detach', () => {
      return workspace.detach()
    })
    this.addAction('doKeymap', async (key: string, defaultReturn = '') => {
      let keymap = workspace.keymaps.get(key)
      if (!keymap) {
        logger.error(`keymap for ${key} not found`)
        return defaultReturn
      }
      let [fn, repeat] = keymap
      let res = await Promise.resolve(fn())
      if (repeat) await nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`)
      return res || defaultReturn
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
    this.addAction('showInfo', async () => {
      if (!this.infoChannel) {
        this.infoChannel = workspace.createOutputChannel('info')
      } else {
        this.infoChannel.clear()
      }
      let channel = this.infoChannel
      channel.appendLine('## versions')
      channel.appendLine('')
      let out = await this.nvim.call('execute', ['version']) as string
      let first = out.trim().split('\n', 2)[0].replace(/\(.*\)/, '').trim()
      channel.appendLine('vim version: ' + first + `${workspace.isVim ? ' ' + workspace.env.version : ''}`)
      channel.appendLine('node version: ' + process.version)
      channel.appendLine('coc.nvim version: ' + this.version)
      channel.appendLine('coc.nvim directory: ' + path.dirname(__dirname))
      channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM))
      channel.appendLine('platform: ' + process.platform)
      channel.appendLine('')
      for (let ch of (workspace as any).outputChannels.values()) {
        if (ch.name !== 'info') {
          channel.appendLine(`## Output channel: ${ch.name}\n`)
          channel.append(ch.content)
          channel.appendLine('')
        }
      }
      channel.show()
    })
    this.addAction('findLocations', (id: string, method: string, params: any, openCommand?: string | false) => {
      return this.handler.findLocations(id, method, params, openCommand)
    })
    this.addAction('links', () => {
      return this.handler.links()
    })
    this.addAction('openLink', () => {
      return this.handler.openLink()
    })
    this.addAction('pickColor', () => {
      return this.handler.pickColor()
    })
    this.addAction('colorPresentation', () => {
      return this.handler.pickPresentation()
    })
    this.addAction('highlight', async () => {
      await this.handler.highlight()
    })
    this.addAction('fold', (kind?: string) => {
      return this.handler.fold(kind)
    })
    this.addAction('startCompletion', async option => {
      await completion.startCompletion(option)
    })
    this.addAction('sourceStat', () => {
      return sources.sourceStats()
    })
    this.addAction('refreshSource', async name => {
      await sources.refresh(name)
    })
    this.addAction('toggleSource', name => {
      sources.toggleSource(name)
    })
    this.addAction('diagnosticInfo', async () => {
      await diagnosticManager.echoMessage()
    })
    this.addAction('diagnosticToggle', () => {
      diagnosticManager.toggleDiagnostic()
    })
    this.addAction('diagnosticNext', async severity => {
      await diagnosticManager.jumpNext(severity)
    })
    this.addAction('diagnosticPrevious', async severity => {
      await diagnosticManager.jumpPrevious(severity)
    })
    this.addAction('diagnosticPreview', async () => {
      await diagnosticManager.preview()
    })
    this.addAction('diagnosticList', () => {
      return diagnosticManager.getDiagnosticList()
    })
    this.addAction('jumpDefinition', openCommand => {
      return this.handler.gotoDefinition(openCommand)
    })
    this.addAction('jumpDeclaration', openCommand => {
      return this.handler.gotoDeclaration(openCommand)
    })
    this.addAction('jumpImplementation', openCommand => {
      return this.handler.gotoImplementation(openCommand)
    })
    this.addAction('jumpTypeDefinition', openCommand => {
      return this.handler.gotoTypeDefinition(openCommand)
    })
    this.addAction('jumpReferences', openCommand => {
      return this.handler.gotoReferences(openCommand)
    })
    this.addAction('doHover', () => {
      return this.handler.onHover()
    })
    this.addAction('showSignatureHelp', () => {
      return this.handler.showSignatureHelp()
    })
    this.addAction('documentSymbols', async () => {
      let doc = await workspace.document
      return await this.handler.getDocumentSymbols(doc)
    })
    this.addAction('symbolRanges', () => {
      return this.handler.getSymbolsRanges()
    })
    this.addAction('selectionRanges', () => {
      return this.handler.getSelectionRanges()
    })
    this.addAction('rangeSelect', (visualmode, forward) => {
      return this.handler.selectRange(visualmode, forward)
    })
    this.addAction('rename', newName => {
      return this.handler.rename(newName)
    })
    this.addAction('getWorkspaceSymbols', async (input: string) => {
      let tokenSource = new CancellationTokenSource()
      return await languages.getWorkspaceSymbols(input, tokenSource.token)
    })
    this.addAction('formatSelected', mode => {
      return this.handler.documentRangeFormatting(mode)
    })
    this.addAction('format', () => {
      return this.handler.documentFormatting()
    })
    this.addAction('commands', () => {
      return this.handler.getCommands()
    })
    this.addAction('services', () => {
      return services.getServiceStats()
    })
    this.addAction('toggleService', name => {
      return services.toggle(name)
    })
    this.addAction('codeAction', (mode, only) => {
      return this.handler.doCodeAction(mode, only)
    })
    this.addAction('organizeImport', () => {
      return this.handler.doCodeAction(null, [CodeActionKind.SourceOrganizeImports])
    })
    this.addAction('fixAll', () => {
      return this.handler.doCodeAction(null, [CodeActionKind.SourceFixAll])
    })
    this.addAction('doCodeAction', codeAction => {
      return this.handler.applyCodeAction(codeAction)
    })
    this.addAction('codeActions', (mode, only) => {
      return this.handler.getCurrentCodeActions(mode, only)
    })
    this.addAction('quickfixes', mode => {
      return this.handler.getCurrentCodeActions(mode, [CodeActionKind.QuickFix])
    })
    this.addAction('codeLensAction', () => {
      return this.handler.doCodeLensAction()
    })
    this.addAction('runCommand', (...args: any[]) => {
      return this.handler.runCommand(...args)
    })
    this.addAction('doQuickfix', () => {
      return this.handler.doQuickfix()
    })
    this.addAction('refactor', () => {
      return this.handler.doRefactor()
    })
    this.addAction('repeatCommand', () => {
      return commandManager.repeatCommand()
    })
    this.addAction('extensionStats', () => {
      return extensions.getExtensionStates()
    })
    this.addAction('activeExtension', name => {
      return extensions.activate(name)
    })
    this.addAction('deactivateExtension', name => {
      return extensions.deactivate(name)
    })
    this.addAction('reloadExtension', name => {
      return extensions.reloadExtension(name)
    })
    this.addAction('toggleExtension', name => {
      return extensions.toggleExtension(name)
    })
    this.addAction('uninstallExtension', (...args: string[]) => {
      return extensions.uninstallExtension(args)
    })
    this.addAction('getCurrentFunctionSymbol', () => {
      return this.handler.getCurrentFunctionSymbol()
    })
    this.addAction('getWordEdit', () => {
      return this.handler.getWordEdit()
    })
    this.addAction('addRanges', async ranges => {
      await this.cursors.addRanges(ranges)
    })
    this.addAction('currentWorkspacePath', () => {
      return workspace.rootPath
    })
    this.addAction('addCommand', cmd => {
      this.addCommand(cmd)
    })
    this.addAction('selectCurrentPlaceholder', (triggerAutocmd?: boolean) => {
      return snippetManager.selectCurrentPlaceholder(!!triggerAutocmd)
    })
    this.addAction('codeActionRange', (start, end, only) => this.handler.codeActionRange(start, end, only))
    workspace.onDidChangeWorkspaceFolders(() => {
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
    })
    commandManager.init(nvim, this)
  }

  private addAction(key: string, fn: Function): void {
    if (this.actions.has(key)) {
      throw new Error(`Action ${key} already exists`)
    }
    this.actions.set(key, fn)
  }

  public addCommand(cmd: { id: string; cmd: string; title?: string }): void {
    let id = `vim.${cmd.id}`
    commandManager.registerCommand(id, async () => {
      await this.nvim.command(cmd.cmd)
    })
    if (cmd.title) commandManager.titles.set(id, cmd.title)
  }

  public async init(): Promise<void> {
    let { nvim } = this
    let s = Date.now()
    try {
      await extensions.init()
      await workspace.init()
      for (let item of workspace.env.vimCommands) {
        this.addCommand(item)
      }
      snippetManager.init()
      completion.init()
      diagnosticManager.init()
      listManager.init(nvim)
      nvim.setVar('coc_workspace_initialized', 1, true)
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
      sources.init()
      this.handler = new Handler(nvim)
      services.init()
      await extensions.activateExtensions()
      workspace.setupDynamicAutocmd(true)
      nvim.setVar('coc_service_initialized', 1, true)
      nvim.call('coc#util#do_autocmd', ['CocNvimInit'], true)
      this._ready = true
      logger.info(`coc.nvim ${this.version} initialized with node: ${process.version} after ${Date.now() - s}ms`)
      this.emit('ready')
    } catch (e) {
      console.error(`Error on initialize: ${e.stack}`)
      logger.error(e.stack)
    }
    workspace.onDidOpenTextDocument(async doc => {
      if (!doc.uri.endsWith(CONFIG_FILE_NAME)) return
      if (extensions.has('coc-json')) return
      workspace.showMessage(`Run :CocInstall coc-json for json intellisense`, 'more')
    })
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
    return workspace.version + (process.env.REVISION ? '-' + process.env.REVISION : '')
  }

  public hasAction(method: string): boolean {
    return this.actions.has(method)
  }

  public async cocAction(method: string, ...args: any[]): Promise<any> {
    let fn = this.actions.get(method)
    return await Promise.resolve(fn.apply(null, args))
  }

  public dispose(): void {
    this.removeAllListeners()
    extensions.dispose()
    listManager.dispose()
    workspace.dispose()
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
