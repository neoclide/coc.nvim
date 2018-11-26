import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import commandManager from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import events from './events'
import extensions from './extensions'
import Handler from './handler'
import services from './services'
import snippetManager from './snippets/manager'
import sources from './sources'
import clean from './util/clean'
import workspace from './workspace'
import { Location } from 'vscode-languageserver-types'
import { OutputChannel } from './types'
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private initialized = false
  private handler: Handler
  private infoChannel: OutputChannel

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    commandManager.init(nvim, this)
    completion.init(nvim)
    clean() // tslint:disable-line
  }

  public async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    sources.init()
    let { nvim } = this
    try {
      await workspace.init()
      services.init()
      this.handler = new Handler(nvim)
      await extensions.init(nvim)
      await nvim.command('doautocmd User CocNvimInit')
      logger.info(`coc initialized with node: ${process.version}`)
      this.emit('ready')
    } catch (e) {
      this.initialized = false
      console.error(`Plugin initialized error: ${e.message}`) // tslint:disable-line
    }
    workspace.onDidOpenTextDocument(async doc => {
      if (!doc.uri.endsWith('coc-settings.json')) return
      if (extensions.has('coc-json') || extensions.isDisabled('coc-json')) return
      let res = await workspace.showPrompt('Install coc-json for json intellisense?')
      if (res) await this.nvim.command('CocInstall coc-json')
    })
  }

  public async sendRequest(id: string, method: string, params?: any): Promise<any> {
    return await services.sendRequest(id, method, params)
  }

  public async findLocations(id: string, method: string, params: any, openCommand?: string): Promise<void> {
    let { document, position } = await workspace.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: document.uri },
      position
    })
    let res: Location[] | null = await services.sendRequest(id, method, params)
    if (!res || res.length == 0) {
      workspace.showMessage(`Location of "${method}" not found!`, 'warning')
      return
    }
    await this.handler.handleLocations(res, openCommand)
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

  public async registExtensions(...folders: string[]): Promise<void> {
    for (let folder of folders) {
      await extensions.loadExtension(folder)
    }
  }

  public async commandList(): Promise<string[]> {
    return commandManager.commandList.map(o => o.id)
  }

  public async cocInstalled(...names: string[]): Promise<void> {
    for (let name of names) {
      await extensions.onExtensionInstall(name)
    }
  }

  public async cocAction(...args: any[]): Promise<any> {
    if (!this.initialized) return
    let { handler } = this
    try {
      switch (args[0] as string) {
        case 'toggle': {
          await events.fire('toggle', [args[1]])
          return
        }
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
        case 'snippetPrev': {
          await snippetManager.previousPlaceholder()
          break
        }
        case 'snippetNext': {
          await snippetManager.nextPlaceholder()
          break
        }
        case 'snippetCancel': {
          snippetManager.cancel()
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
          return diagnosticManager.diagnosticList()
        case 'jumpDefinition':
          await handler.gotoDefinition(args[1])
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
          handler.showSignatureHelp()
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
        case 'codeLens':
          return handler.doCodeLens()
        case 'codeLensAction':
          return handler.doCodeLensAction()
        case 'runCommand':
          return await handler.runCommand(...args.slice(1))
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
          return await extensions.uninstallExtension(args[1])
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

  public async dispose(): Promise<void> {
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
