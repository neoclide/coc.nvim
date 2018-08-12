import {NeovimClient as Neovim} from '@chemzqm/neovim'
import commandManager from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import Handler from './handler'
import remoteStore from './remote-store'
import services from './services'
import snippetManager from './snippet/manager'
import {VimCompleteItem} from './types'
import {echoErr} from './util'
import clean from './util/clean'
import workspace from './workspace'
import Emitter from 'events'
import once from 'once'
import Sources from './sources'
const logger = require('./util/logger')('plugin')

export default class Plugin {
  private initialized = false
  private handler: Handler
  public emitter: Emitter
  public onEnter: () => void

  constructor(public nvim: Neovim) {
    Object.defineProperty(workspace, 'nvim', {
      get: () => nvim
    })
    let emitter = this.emitter = new Emitter()
    Object.defineProperty(workspace, 'emitter', {
      get: () => emitter
    })
    this.handler = new Handler(nvim, this.emitter, services)
    services.init(nvim)
    commandManager.init(nvim, this)
    this.onEnter = once(() => {
      this.onInit().catch(err => {
        logger.error(err.stack)
        echoErr(nvim, `Initialize failed, ${err.message}`)
      })
    })
    clean() // tslint:disable-line
  }

  private async onInit(): Promise<void> {
    let {nvim} = this
    await workspace.init()
    this.initialized = true
    nvim.command('doautocmd User CocNvimInit')
    logger.info('Coc initialized')
    completion.init(nvim, this.emitter)
    let sources = new Sources(nvim)
    Object.defineProperty(workspace, 'sources', {
      get: () => sources
    })
  }

  // callback for remote sources
  public async cocResult(args: [number, string, VimCompleteItem[]]): Promise<void> {
    let [id, name, items] = args
    id = Number(id)
    items = items || []
    logger.trace(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  public async cocAutocmd(args: any): Promise<void> {
    let {emitter} = this
    logger.debug('Autocmd:', args)
    switch (args[0] as string) {
      case 'BufEnter':
      case 'BufWinEnter':
      case 'BufCreate':
      case 'BufWritePost':
      case 'BufUnload':
      case 'BufHidden':
      case 'BufLeave':
      case 'DirChanged':
      case 'TextChanged':
      case 'InsertCharPre':
      case 'InsertLeave':
      case 'InsertEnter':
      case 'CompleteDone':
      case 'TextChangedP':
      case 'TextChangedI':
      case 'CursorMovedI':
      case 'CursorMoved':
      case 'FileType':
      case 'BufWritePre':
      case 'OptionSet':
        let fns = emitter.listeners(args[0])
        for (let fn of fns) {
          await Promise.resolve(fn.apply(null, args.slice(1)))
        }
        break
      default:
        logger.error(`Unknown event ${args[0]}`)
    }
  }

  public async cocAction(args: any): Promise<any> {
    if (!this.initialized) return
    let {handler} = this
    try {
      switch (args[0] as string) {
        case 'onlySource':
          await completion.onlySource(args[1])
          break
        case 'snippetPrev': {
          await snippetManager.jumpPrev()
          break
        }
        case 'snippetNext': {
          await snippetManager.jumpNext()
          break
        }
        case 'snippetCancel': {
          await snippetManager.detach()
          break
        }
        case 'startCompletion':
          completion.startCompletion(args[1])
          break
        case 'sourceStat':
          return await completion.sourceStat()
        case 'refreshSource':
          await workspace.sources.refresh(args[1])
          break
        case 'toggleSource':
          completion.toggleSource(args[1])
          break
        case 'diagnosticNext':
          diagnosticManager.jumpNext().catch(e => {
            logger.error(e.message)
          })
          break
        case 'diagnosticPrevious':
          diagnosticManager.jumpPrevious().catch(e => {
            logger.error(e.message)
          })
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
          setTimeout(() => {
            handler.showSignatureHelp()
          }, 20)
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
        default:
          logger.error(`unknown action ${args[0]}`)
      }
    } catch (e) {
      logger.error(e.stack)
    }
  }

  public async dispose():Promise<void> {
    workspace.dispose()
    await services.stopAll()
    services.dispose()
    this.emitter.removeAllListeners()
    this.handler.dispose()
    remoteStore.dispose()
    snippetManager.dispose()
    commandManager.dispose()
    completion.dispose()
    diagnosticManager.dispose()
  }
}
