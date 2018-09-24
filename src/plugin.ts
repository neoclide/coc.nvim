import { Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import commandManager from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import extensions from './extensions'
import Handler from './handler'
import services from './services'
import snippetManager from './snippet/manager'
import sources from './sources'
import clean from './util/clean'
import workspace from './workspace'
const logger = require('./util/logger')('plugin')

export default class Plugin extends EventEmitter {
  private initialized = false
  private handler: Handler

  constructor(public nvim: Neovim) {
    super()
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    sources.init()
    services.init()
    commandManager.init(nvim, this)
    completion.init(nvim)
    clean() // tslint:disable-line
  }

  public async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    let { nvim } = this
    await workspace.init()
    this.handler = new Handler(nvim)
    await extensions.init(nvim)
    await nvim.command('doautocmd User CocNvimInit')
    logger.info('coc initialized')
    this.emit('ready')
    if (global.hasOwnProperty('__TEST__')) return
    workspace.onDidOpenTextDocument(async doc => {
      if (!doc.uri.endsWith('coc-settings.json')) return
      if (extensions.has('coc-json') || extensions.isDisabled('coc-json')) return
      workspace.showMessage('Installing coc-json for json Intellisense')
      await this.nvim.command('CocInstall coc-json')
    })
  }

  public async cocAction(args: any): Promise<any> {
    if (!this.initialized) return
    let { handler } = this
    try {
      switch (args[0] as string) {
        case 'links': {
          await workspace.echoLines(['a', 'b', 'd', 'e'])
          return await handler.links()
        }
        case 'openLink': {
          return await handler.openLink(args[1])
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
          await snippetManager.jumpPrev()
          break
        }
        case 'snippetNext': {
          await snippetManager.jumpNext()
          break
        }
        case 'snippetCancel': {
          snippetManager.detach()
          break
        }
        case 'startCompletion':
          completion.startCompletion(args[1])
          break
        case 'sourceStat':
          return await completion.sourceStat()
        case 'refreshSource':
          await sources.refresh(args[1])
          break
        case 'toggleSource':
          completion.toggleSource(args[1])
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
          await handler.gotoDefinition()
          break
        case 'jumpImplementation':
          await handler.gotoImplementaion()
          break
        case 'jumpTypeDefinition':
          await handler.gotoTypeDefinition()
          break
        case 'jumpReferences':
          await handler.gotoReferences()
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
          return extensions.activate(args[1])
        case 'deactivateExtension':
          return extensions.deactivate(args[1])
        case 'reloadExtension':
          return await extensions.reloadExtension(args[1])
        case 'toggleExtension':
          return await extensions.toggleExtension(args[1])
        case 'uninstallExtension':
          return await extensions.uninstallExtension(args[1])
        default:
          logger.error(`unknown action ${args[0]}`)
      }
    } catch (e) {
      workspace.showMessage(`Error on '${args[0]}': ${e.message}`, 'error')
      logger.error(e.stack)
    }
  }

  public async dispose(): Promise<void> {
    workspace.dispose()
    sources.dispose()
    await services.stopAll()
    services.dispose()
    this.handler.dispose()
    snippetManager.dispose()
    commandManager.dispose()
    completion.dispose()
    diagnosticManager.dispose()
  }
}
