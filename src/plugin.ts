import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import { CodeActionKind, Location } from 'vscode-languageserver-types'
import commandManager from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import extensions from './extensions'
import Handler from './handler'
import listManager from './list/manager'
import services from './services'
import snippetManager from './snippets/manager'
import sources from './sources'
import { Autocmd, OutputChannel, PatternType } from './types'
import Cursors from './cursors'
import clean from './util/clean'
import workspace from './workspace'
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private _ready = false
  private handler: Handler
  private infoChannel: OutputChannel
  private cursors: Cursors

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    this.cursors = new Cursors(nvim)
    this.addMethod('hasProvider', async (id: string) => {
      return this.handler.hasProvider(id)
    })
    this.addMethod('hasSelected', () => {
      return completion.hasSelected()
    })
    this.addMethod('listNames', () => {
      return listManager.names
    })
    this.addMethod('search', (...args: string[]) => {
      return this.handler.search(args)
    })
    this.addMethod('cursorsSelect', (bufnr: number, kind: string, mode: string) => {
      return this.cursors.select(bufnr, kind, mode)
    })
    this.addMethod('codeActionRange', (start, end, only) => {
      return this.handler.codeActionRange(start, end, only)
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
    this.addMethod('updateExtensions', async () => {
      await extensions.updateExtensions()
    })
    this.addMethod('commandList', () => {
      return commandManager.commandList.map(o => o.id)
    })
    this.addMethod('openList', async (...args: string[]) => {
      await this.ready
      await listManager.start(args)
    })
    this.addMethod('runCommand', async (...args: string[]) => {
      await this.ready
      return await this.handler.runCommand(...args)
    })
    this.addMethod('selectFunction', async (inner: boolean, visualmode: string) => {
      return await this.handler.selectFunction(inner, visualmode)
    })
    this.addMethod('listResume', () => {
      return listManager.resume()
    })
    this.addMethod('listPrev', () => {
      return listManager.previous()
    })
    this.addMethod('listNext', () => {
      return listManager.next()
    })
    this.addMethod('detach', () => {
      return workspace.detach()
    })
    this.addMethod('sendRequest', (id: string, method: string, params?: any) => {
      return services.sendRequest(id, method, params)
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
    this.addMethod('openLog', () => {
      let file = logger.getLogFile()
      nvim.call(`coc#util#open_file`, ['edit', file], true)
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
    workspace.onDidChangeWorkspaceFolders(() => {
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
    })
    commandManager.init(nvim, this)
    clean() // tslint:disable-line
  }

  private addMethod(name: string, fn: Function): any {
    Object.defineProperty(this, name, { value: fn })
  }

  public addCommand(cmd: { id: string, cmd: string, title?: string }): void {
    let id = `vim.${cmd.id}`
    commandManager.registerCommand(id, async () => {
      await this.nvim.command(cmd.cmd)
    })
    if (cmd.title) commandManager.titles.set(id, cmd.title)
  }

  public async init(): Promise<void> {
    let { nvim } = this
    try {
      await extensions.init()
      await workspace.init()
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
      let cmds = await nvim.getVar('coc_vim_commands') as any[]
      if (cmds && cmds.length) {
        for (let cmd of cmds) {
          this.addCommand(cmd)
        }
      }
      logger.info(`coc ${this.version} initialized with node: ${process.version}`)
      this.emit('ready')
    } catch (e) {
      this._ready = false
      console.error(`Error on initialize: ${e.stack}`) // tslint:disable-line
      logger.error(e.stack)
    }

    workspace.onDidOpenTextDocument(async doc => {
      if (!doc.uri.endsWith('coc-settings.json')) return
      if (extensions.has('coc-json') || extensions.isDisabled('coc-json')) return
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
      function getLocation(item: any): void {
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

  public async snippetCheck(checkExpand: boolean, checkJump: boolean): Promise<boolean> {
    if (checkExpand && !extensions.has('coc-snippets')) {
      // tslint:disable-next-line: no-console
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
  }

  public get version(): string {
    return workspace.version + (process.env.REVISION ? '-' + process.env.REVISION : '')
  }

  public async showInfo(): Promise<void> {
    if (!this.infoChannel) {
      this.infoChannel = workspace.createOutputChannel('info')
    } else {
      this.infoChannel.clear()
    }
    let channel = this.infoChannel
    channel.appendLine('## versions')
    channel.appendLine('')
    let out = await this.nvim.call('execute', ['version']) as string
    channel.appendLine('vim version: ' + out.trim().split('\n', 2)[0])
    channel.appendLine('node version: ' + process.version)
    channel.appendLine('coc.nvim version: ' + this.version)
    channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM))
    channel.appendLine('platform: ' + process.platform)
    channel.appendLine('')
    channel.appendLine('## Messages')
    let msgs = await this.nvim.call('coc#rpc#get_errors') as string[]
    channel.append(msgs.join('\n'))
    channel.appendLine('')
    for (let ch of (workspace as any).outputChannels.values()) {
      if (ch.name !== 'info') {
        channel.appendLine(`## Output channel: ${ch.name}\n`)
        channel.append(ch.content)
        channel.appendLine('')
      }
    }
    channel.show()
  }

  public async cocAction(...args: any[]): Promise<any> {
    if (!this._ready) return
    let { handler } = this
    try {
      switch (args[0] as string) {
        case 'links': {
          return await handler.links()
        }
        case 'openLink': {
          return await handler.openLink()
        }
        case 'pickColor': {
          return await handler.pickColor()
        }
        case 'colorPresentation': {
          return await handler.pickPresentation()
        }
        case 'highlight': {
          await handler.highlight()
          break
        }
        case 'fold': {
          return await handler.fold(args[1])
        }
        case 'startCompletion':
          await completion.startCompletion(args[1])
          break
        case 'sourceStat':
          return sources.sourceStats()
        case 'refreshSource':
          await sources.refresh(args[1])
          break
        case 'toggleSource':
          sources.toggleSource(args[1])
          break
        case 'diagnosticInfo':
          await diagnosticManager.echoMessage()
          break
        case 'diagnosticNext':
          await diagnosticManager.jumpNext(args[1])
          break
        case 'diagnosticPrevious':
          await diagnosticManager.jumpPrevious(args[1])
          break
        case 'diagnosticPreview':
          await diagnosticManager.preview()
          break
        case 'diagnosticList':
          return diagnosticManager.getDiagnosticList()
        case 'jumpDefinition':
          return await handler.gotoDefinition(args[1])
        case 'jumpDeclaration':
          return await handler.gotoDeclaration(args[1])
        case 'jumpImplementation':
          return await handler.gotoImplementation(args[1])
        case 'jumpTypeDefinition':
          return await handler.gotoTypeDefinition(args[1])
        case 'jumpReferences':
          return await handler.gotoReferences(args[1])
        case 'doHover':
          return await handler.onHover()
        case 'showSignatureHelp':
          return await handler.showSignatureHelp()
        case 'documentSymbols':
          return await handler.getDocumentSymbols()
        case 'symbolRanges':
          return await handler.getSymbolsRanges()
        case 'selectionRanges':
          return await handler.getSelectionRanges()
        case 'rangeSelect':
          return await handler.selectRange(args[1], args[2])
        case 'rename':
          await handler.rename(args[1])
          return
        case 'workspaceSymbols':
          this.nvim.command('CocList -I symbols', true)
          return
        case 'formatSelected':
          return await handler.documentRangeFormatting(args[1])
        case 'format':
          return await handler.documentFormatting()
        case 'commands':
          return await handler.getCommands()
        case 'services':
          return services.getServiceStats()
        case 'toggleService':
          return services.toggle(args[1])
        case 'codeAction':
          return handler.doCodeAction(args[1], args[2])
        case 'doCodeAction':
          return await handler.applyCodeAction(args[1])
        case 'codeActions':
          return await handler.getCurrentCodeActions(args[1], args[2])
        case 'quickfixes':
          return await handler.getCurrentCodeActions(args[1], [CodeActionKind.QuickFix])
        case 'codeLensAction':
          return handler.doCodeLensAction()
        case 'runCommand':
          return await handler.runCommand(...args.slice(1))
        case 'doQuickfix':
          return await handler.doQuickfix()
        case 'refactor':
          return await handler.doRefactor()
        case 'repeatCommand':
          return await commandManager.repeatCommand()
        case 'extensionStats':
          return await extensions.getExtensionStates()
        case 'activeExtension':
          return extensions.activate(args[1], false)
        case 'deactivateExtension':
          return extensions.deactivate(args[1])
        case 'reloadExtension':
          return await extensions.reloadExtension(args[1])
        case 'toggleExtension':
          return await extensions.toggleExtension(args[1])
        case 'uninstallExtension':
          return await extensions.uninstallExtension(args.slice(1))
        case 'getCurrentFunctionSymbol':
          return await handler.getCurrentFunctionSymbol()
        case 'getWordEdit':
          return await handler.getWordEdit()
        case 'addRanges':
          return await this.cursors.addRanges(args[1])
        default:
          workspace.showMessage(`unknown action ${args[0]}`, 'error')
      }
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
