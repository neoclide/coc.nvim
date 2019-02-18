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
import { OutputChannel, Autocmd } from './types'
import { isRunning } from './util'
import clean from './util/clean'
import workspace from './workspace'
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private ready = false
  private handler: Handler
  private infoChannel: OutputChannel
  private interval: NodeJS.Timeout

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    commandManager.init(nvim, this)
    clean() // tslint:disable-line
  }

  public async init(): Promise<void> {
    let { nvim } = this
    try {
      let config = await nvim.getVar('coc_user_config') as { [key: string]: any } || {}
      workspace.configurations.updateUserConfig(config)
      let pid = await nvim.call('getpid') as number
      this.checkProcess(pid)
      await listManager.init(nvim)
      await workspace.init()
      nvim.setVar('coc_workspace_initialized', 1, true)
      await completion.init(nvim)
      sources.init()
      services.init()
      this.handler = new Handler(nvim)
      await extensions.init(nvim)
      nvim.setVar('coc_process_pid', process.pid, true)
      nvim.setVar('coc_service_initialized', 1, true)
      await nvim.command('silent doautocmd User CocNvimInit')
      this.ready = true
      logger.info(`coc initialized with node: ${process.version}`)
      this.emit('ready')
    } catch (e) {
      this.ready = false
      console.error(`Plugin initialized error: ${e.stack}`) // tslint:disable-line
    }
    workspace.onDidOpenTextDocument(async doc => {
      if (!doc.uri.endsWith('coc-settings.json')) return
      if (extensions.has('coc-json') || extensions.isDisabled('coc-json')) return
      let res = await workspace.showPrompt('Install coc-json for json intellisense?')
      if (res) await this.nvim.command('CocInstall coc-json')
    })
  }

  public async sendRequest(id: string, method: string, params?: any): Promise<any> {
    if (!method) {
      workspace.showMessage('method required for send request', 'error')
      return
    }
    return await services.sendRequest(id, method, params)
  }

  public async doAutocmd(id: number, ...args: []): Promise<void> {
    let autocmd = (workspace as any).autocmds.get(id) as Autocmd
    if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
  }

  public updateConfig(section: string, val: any): void {
    workspace.configurations.updateUserConfig({ [section]: val })
  }

  public hasSelected(): boolean {
    return completion.hasSelected()
  }

  public getCurrentIndex(): number {
    return completion.index
  }

  public listNames(): string[] {
    return listManager.names
  }

  public async findLocations(id: string, method: string, params: any, openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: document.uri },
      position
    })
    let res: any = await services.sendRequest(id, method, params)
    if (!res) {
      workspace.showMessage(`Location of "${method}" not found!`, 'warning')
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

  public async openLog(): Promise<void> {
    let file = process.env.NVIM_COC_LOG_FILE || path.join(os.tmpdir(), 'coc-nvim.log')
    let escaped = await this.nvim.call('fnameescape', file)
    await this.nvim.command(`edit ${escaped}`)
  }

  public async showInfo(): Promise<void> {
    if (!this.infoChannel) {
      this.infoChannel = workspace.createOutputChannel('info')
    } else {
      this.infoChannel.clear()
    }
    let channel = this.infoChannel
    channel.show()
    channel.appendLine('## versions')
    channel.appendLine('')
    let out = await this.nvim.call('execute', ['version']) as string
    channel.appendLine('vim version: ' + out.trim().split('\n', 2)[0])
    channel.appendLine('node version: ' + process.version)
    channel.appendLine('coc.nvim version: ' + workspace.version)
    channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM))
    channel.appendLine('platform: ' + process.platform)
    channel.appendLine('')
    channel.appendLine('## Error messages')
    let msgs = await this.nvim.call('coc#rpc#get_errors') as string[]
    channel.append(msgs.join('\n'))
    channel.appendLine('')
    for (let ch of (workspace as any).outputChannels.values()) {
      if (ch.name !== 'info') {
        channel.appendLine(`## Output channel: ${ch.name}`)
        channel.append(ch.content)
        channel.appendLine('')
      }
    }
  }

  public async addExtensions(): Promise<void> {
    await extensions.addExtensions()
  }

  public async registExtensions(...folders: string[]): Promise<void> {
    for (let folder of folders) {
      await extensions.loadExtension(folder)
    }
  }

  public async commandList(): Promise<string[]> {
    return commandManager.commandList.map(o => o.id)
  }

  public async openList(...args: string[]): Promise<void> {
    await listManager.start(args)
  }

  public async doKeymap(key: string, defaultReturn = ''): Promise<any> {
    let fn = workspace.keymaps.get(key)
    if (!fn) {
      logger.error(`keymap for ${key} not found`)
      return defaultReturn
    }
    let res = await Promise.resolve(fn())
    return res || defaultReturn
  }

  public async cocInstalled(names: string): Promise<void> {
    for (let name of names.split(/\s+/)) {
      await extensions.onExtensionInstall(name)
    }
  }

  public async listResume(): Promise<void> {
    listManager.resume()
  }

  public async listPrev(): Promise<void> {
    listManager.previous()
  }

  public async listNext(): Promise<void> {
    listManager.next()
  }

  public async detach(): Promise<void> {
    await workspace.detach()
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
              if (statusItem) statusItem.text = 'Upgrading coc extensions...'
              await workspace.runCommand('yarn upgrade --latest --ignore-engines', cwd, 300000)
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
    if (!this.ready) return
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
          // denite would clear message without timer
          setTimeout(() => {
            diagnosticManager.echoMessage().catch(e => {
              logger.error(e)
            })
          }, 40)
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
          handler.onHover().catch(e => {
            logger.error(e.message)
          })
          break
        case 'showSignatureHelp':
          await handler.showSignatureHelp()
          break
        case 'documentSymbols':
          return handler.getDocumentSymbols()
        case 'rename':
          await handler.rename()
          return
        case 'workspaceSymbols':
          return await handler.getWorkspaceSymbols()
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
          return extensions.getExtensionStates()
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
        default:
          workspace.showMessage(`unknown action ${args[0]}`, 'error')
      }
    } catch (e) {
      if (!/\btimeout\b/.test(e.message)) {
        workspace.showMessage(`Error on '${args[0]}': ${e.message}`, 'error')
      }
      logger.error(e.stack)
    }
  }

  private checkProcess(pid: number): void {
    if (global.hasOwnProperty('__TEST__')) return
    this.interval = setInterval(() => {
      if (!isRunning(pid)) {
        process.exit()
      }
    }, 15000)
  }

  public async snippetCancel(): Promise<void> {
    snippetManager.cancel()
  }

  public async snippetPrev(): Promise<string> {
    await snippetManager.previousPlaceholder()
    return ''
  }

  public async snippetNext(): Promise<string> {
    await snippetManager.nextPlaceholder()
    return ''
  }

  public async dispose(): Promise<void> {
    if (this.interval) clearInterval(this.interval)
    this.removeAllListeners()
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
