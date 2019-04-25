import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import https from 'https'
import os from 'os'
import path from 'path'
import semver from 'semver'
import { Location } from 'vscode-languageserver-types'
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
import clean from './util/clean'
import workspace from './workspace'
import debounce = require('debounce')
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private _ready = false
  private handler: Handler
  private infoChannel: OutputChannel

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    this.addMethod('hasSelected', () => {
      return completion.hasSelected()
    })
    this.addMethod('listNames', () => {
      return listManager.names
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
    this.addMethod('installExtensions', debounce(async () => {
      let list = await nvim.getVar('coc_global_extensions') as string[]
      await extensions.installExtensions(list)
    }, 200))
    this.addMethod('commandList', () => {
      return commandManager.commandList.map(o => o.id)
    })
    this.addMethod('openList', async (...args: string[]) => {
      await this.ready
      await listManager.start(args)
    })
    this.addMethod('runCommand', async (...args: string[]) => {
      await this.ready
      await this.handler.runCommand(...args)
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
    this.addMethod('doAutocmd', async (id: number, ...args: []) => {
      let autocmd = (workspace as any).autocmds.get(id) as Autocmd
      if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
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
    this.addMethod('cocInstalled', async (names: string) => {
      for (let name of names.split(/\s+/)) {
        await extensions.onExtensionInstall(name)
      }
    })
    this.addMethod('openLog', async () => {
      let file = process.env.NVIM_COC_LOG_FILE || path.join(os.tmpdir(), 'coc-nvim.log')
      let escaped = await this.nvim.call('fnameescape', file)
      await this.nvim.command(`edit ${escaped}`)
    })
    this.addMethod('doKeymap', async (key: string, defaultReturn = '') => {
      let fn = workspace.keymaps.get(key)
      if (!fn) {
        logger.error(`keymap for ${key} not found`)
        return defaultReturn
      }
      let res = await Promise.resolve(fn())
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
    Object.defineProperty(this, name, {
      value: fn
    })
  }

  public async init(): Promise<void> {
    let { nvim } = this
    try {
      await extensions.init(nvim)
      await workspace.init()
      diagnosticManager.init()
      listManager.init(nvim)
      nvim.setVar('coc_workspace_initialized', 1, true)
      nvim.setVar('coc_process_pid', process.pid, true)
      nvim.setVar('WorkspaceFolders', workspace.folderPaths, true)
      completion.init(nvim)
      sources.init()
      this.handler = new Handler(nvim)
      services.init()
      extensions.activateExtensions()
      nvim.setVar('coc_service_initialized', 1, true)
      nvim.call('coc#_init', [], true)
      this._ready = true
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
      let res = await workspace.showPrompt('Install coc-json for json intellisense?')
      if (res) await this.nvim.command('CocInstall coc-json')
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
    channel.appendLine('## Error messages')
    let msgs = await this.nvim.call('coc#rpc#get_errors') as string[]
    channel.append(msgs.join('\n'))
    channel.appendLine('')
    for (let ch of (workspace as any).outputChannels.values()) {
      logger.debug('name:', ch.name)
      if (ch.name !== 'info') {
        channel.appendLine(`## Output channel: ${ch.name}\n`)
        channel.append(ch.content)
        channel.appendLine('')
      }
    }
    channel.show()
  }

  public updateExtension(): Promise<void> {
    let { nvim } = this
    let statusItem = workspace.createStatusBarItem(0, { progress: true })
    if (statusItem) {
      statusItem.text = 'Checking latest release'
      statusItem.show()
    }
    return new Promise((resolve, reject) => {
      const req = https.request('https://api.github.com/repos/neoclide/coc.nvim/releases/latest', res => {
        let content = ''
        res.on('data', d => {
          content = content + d
        })
        res.on('end', async () => {
          try {
            let obj = JSON.parse(content)
            let latest = obj.tag_name.replace(/^v/, '')
            if (semver.gt(latest, workspace.version)) {
              console.error(`Please upgrade coc.nvim to latest version: ${latest}`) // tslint:disable-line
            } else {
              let cwd = await nvim.call('coc#util#extension_root') as string
              let yarncmd = await nvim.call('coc#util#yarn_cmd') as string
              if (!yarncmd) return
              if (statusItem) statusItem.text = 'Upgrading coc extensions...'
              await workspace.runCommand(`${yarncmd} upgrade --latest --ignore-engines`, cwd, 300000)
              if (statusItem) statusItem.dispose()
            }
            resolve()
          } catch (e) {
            console.error(`Update error: ${e.message}`) // tslint:disable-line
            if (statusItem) statusItem.hide()
            resolve()
          }
        })
      })
      req.on('error', e => {
        reject(e)
      })
      req.setHeader('User-Agent', 'NodeJS')
      req.end()
    })
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
          await handler.fold(args[1])
          break
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
          await diagnosticManager.jumpNext()
          break
        case 'diagnosticPrevious':
          await diagnosticManager.jumpPrevious()
          break
        case 'diagnosticList':
          return diagnosticManager.getDiagnosticList()
        case 'jumpDefinition':
          await handler.gotoDefinition(args[1])
          break
        case 'jumpDeclaration':
          await handler.gotoDeclaration(args[1])
          break
        case 'jumpImplementation':
          await handler.gotoImplementation(args[1])
          break
        case 'jumpTypeDefinition':
          await handler.gotoTypeDefinition(args[1])
          break
        case 'jumpReferences':
          await handler.gotoReferences(args[1])
          break
        case 'doHover':
          await handler.onHover()
          break
        case 'showSignatureHelp':
          await handler.showSignatureHelp()
          break
        case 'documentSymbols':
          return await handler.getDocumentSymbols()
        case 'selectionRanges':
          return await handler.getSelectionRanges()
        case 'rename':
          await handler.rename()
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
          return handler.doCodeAction(args[1])
        case 'codeLensAction':
          return handler.doCodeLensAction()
        case 'runCommand':
          return await handler.runCommand(...args.slice(1))
        case 'quickfixes':
          return await handler.getQuickfixActions()
        case 'doQuickfix':
          return await handler.doQuickfix()
        case 'doCodeAction':
          return await handler.applyCodeAction(args[1])
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
