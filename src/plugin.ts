import { NeovimClient as Neovim } from '@chemzqm/neovim'
import path from 'path'
import { EventEmitter } from 'events'
import { CodeActionKind, Location } from 'vscode-languageserver-types'
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
    this.addMethod('hasProvider', (id: string) => this.handler.hasProvider(id))
    this.addMethod('getTagList', async () => await this.handler.getTagList())
    this.addMethod('hasSelected', () => completion.hasSelected())
    this.addMethod('listNames', () => listManager.names)
    this.addMethod('search', (...args: string[]) => this.handler.search(args))
    this.addMethod('cursorsSelect', (bufnr: number, kind: string, mode: string) => this.cursors.select(bufnr, kind, mode))
    this.addMethod('codeActionRange', (start, end, only) => this.handler.codeActionRange(start, end, only))
    this.addMethod('getConfig', async key => {
      let document = await workspace.document
      // eslint-disable-next-line id-blacklist
      return workspace.getConfiguration(key, document ? document.uri : undefined)
    })
    this.addMethod('rootPatterns', bufnr => {
      let doc = workspace.getDocument(bufnr)
      if (!doc) return null
      return {
        buffer: workspace.getRootPatterns(doc, PatternType.Buffer),
        server: workspace.getRootPatterns(doc, PatternType.LanguageServer),
        global: workspace.getRootPatterns(doc, PatternType.Global)
      }
    })
    this.addMethod('installExtensions', async (...list: string[]) => {
      await extensions.installExtensions(list)
    })
    this.addMethod('saveRefactor', async (bufnr: number) => {
      await this.handler.saveRefactor(bufnr)
    })
    this.addMethod('updateExtensions', async (sync?: boolean) => {
      await extensions.updateExtensions(sync)
    })
    this.addMethod('commandList', () => commandManager.commandList.map(o => o.id))
    this.addMethod('openList', async (...args: string[]) => {
      await this.ready
      await listManager.start(args)
    })
    this.addMethod('runCommand', async (...args: string[]) => {
      await this.ready
      return await this.handler.runCommand(...args)
    })
    this.addMethod('selectSymbolRange', async (inner: boolean, visualmode: string, supportedSymbols: string[]) => await this.handler.selectSymbolRange(inner, visualmode, supportedSymbols))
    this.addMethod('listResume', () => listManager.resume())
    this.addMethod('listPrev', () => listManager.previous())
    this.addMethod('listNext', () => listManager.next())
    this.addMethod('detach', () => workspace.detach())
    this.addMethod('sendRequest', (id: string, method: string, params?: any) => services.sendRequest(id, method, params))
    this.addMethod('sendNotification', async (id: string, method: string, params?: any) => {
      await services.sendNotification(id, method, params)
    })
    this.addMethod('registNotification', async (id: string, method: string) => {
      await services.registNotification(id, method)
    })
    this.addMethod('doAutocmd', async (id: number, ...args: []) => {
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
    this.addMethod('updateConfig', (section: string, val: any) => {
      workspace.configurations.updateUserConfig({ [section]: val })
    })
    this.addMethod('snippetNext', async () => {
      await snippetManager.nextPlaceholder()
      return ''
    })
    this.addMethod('snippetPrev', async () => {
      await snippetManager.previousPlaceholder()
      return ''
    })
    this.addMethod('snippetCancel', () => {
      snippetManager.cancel()
    })
    this.addMethod('openLocalConfig', async () => {
      await workspace.openLocalConfig()
    })
    this.addMethod('openLog', () => {
      let file = logger.getLogFile()
      nvim.call(`coc#util#open_url`, [file], true)
    })
    this.addMethod('doKeymap', async (key: string, defaultReturn = '') => {
      let [fn, repeat] = workspace.keymaps.get(key)
      if (!fn) {
        logger.error(`keymap for ${key} not found`)
        return defaultReturn
      }
      let res = await Promise.resolve(fn())
      if (repeat) await nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`)
      return res || defaultReturn
    })
    this.addMethod('registExtensions', async (...folders: string[]) => {
      for (let folder of folders) {
        await extensions.loadExtension(folder)
      }
    })
    this.addMethod('snippetCheck', async (checkExpand: boolean, checkJump: boolean) => {
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
    this.addMethod('showInfo', async () => {
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
      channel.appendLine('coc.nivm directory: ' + path.dirname(__dirname))
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
    // register actions
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
    this.addAction('tokenSource', name => {
      sources.toggleSource(name)
    })
    this.addAction('diagnosticInfo', async () => {
      await diagnosticManager.echoMessage()
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
    this.addAction('documentSymbols', () => {
      return this.handler.getDocumentSymbols()
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
    this.addAction('getWorkspaceSymbols', async (input: string, bufnr: number) => {
      if (!bufnr) bufnr = await this.nvim.eval('bufnr("%")') as number
      let document = workspace.getDocument(bufnr)
      if (!document) return
      return await languages.getWorkspaceSymbols(document.textDocument, input)
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

  private addMethod(name: string, fn: Function): any {
    if (this.hasOwnProperty(name)) {
      throw new Error(`Method ${name} already exists`)
    }
    Object.defineProperty(this, name, { value: fn })
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
      await workspace.init()
      await extensions.init()
      for (let item of workspace.env.vimCommands) {
        this.addCommand(item)
      }
      snippetManager.init()
      completion.init()
      diagnosticManager.init()
      listManager.init(nvim)
      nvim.setVar('coc_workspace_initialized', 1, true)
      nvim.setVar('coc_process_pid', process.pid, true)
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
      sources.init()
      this.handler = new Handler(nvim)
      services.init()
      await extensions.activateExtensions()
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
      if (extensions.has('coc-json') || extensions.isDisabled('coc-json')) return
      workspace.showMessage(`Run: CocInstall coc-json for json intellisense`, 'more')
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

  public async findLocations(id: string, method: string, params: any, openCommand?: string | false): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: document.uri },
      position
    })
    let res: any = await services.sendRequest(id, method, params)
    if (!res) {
      workspace.showMessage(`Locations of "${method}" not found!`, 'warning')
      return
    }
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
    await this.handler.handleLocations(locations, openCommand)
  }

  private get version(): string {
    return workspace.version + (process.env.REVISION ? '-' + process.env.REVISION : '')
  }

  public async cocAction(...args: any[]): Promise<any> {
    if (!this._ready) return
    let [method, ...others] = args
    let fn = this.actions.get(method)
    if (!fn) {
      workspace.showMessage(`Method "${method}" not exists for CocAction.`, 'error')
      return
    }
    try {
      return await Promise.resolve(fn.apply(null, others))
    } catch (e) {
      let message = e.hasOwnProperty('message') ? e.message : e.toString()
      if (!/\btimeout\b/.test(message)) {
        workspace.showMessage(`Error on '${args[0]}': ${message}`, 'error')
      }
      if (e.stack) logger.error(e.stack)
    }
  }

  public async dispose(): Promise<void> {
    this.removeAllListeners()
    extensions.dispose()
    listManager.dispose()
    workspace.dispose()
    sources.dispose()
    await services.stopAll()
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
