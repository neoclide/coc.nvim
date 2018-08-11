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
const logger = require('./util/logger')('index')

export default class Plugin {
  private initialized = false
  private handler: Handler
  public emitter: Emitter
  public onEnter: () => void

  constructor(public nvim: Neovim) {
    (workspace as any)._nvim = nvim
    let emitter = this.emitter = new Emitter()
    this.handler = new Handler(nvim, this.emitter, services)
    Object.defineProperty(workspace, 'emitter', {
      get: () => {
        return emitter
      }
    })
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
    let buf = await nvim.buffer
    await workspace.init()
    workspace.bufferEnter(buf.id)
    this.initialized = true
    nvim.command('doautocmd User CocNvimInit')
    logger.info('Coc initialized')
    completion.init(nvim, this.emitter)
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
      case 'DirChanged':
        workspace.onDirChanged(args[1])
      case 'TextChanged':
        emitter.emit('TextChanged', args[1])
        break
      case 'BufEnter':
        workspace.bufferEnter(args[1])
        break
      case 'BufCreate':
        await workspace.onBufferCreate(args[1])
        break
      case 'BufWritePre':
        await workspace.onBufferWillSave(args[1])
        break
      case 'BufWritePost':
        await workspace.onBufferDidSave(args[1])
        break
      case 'BufCreate':
        await workspace.onBufferCreate(args[1])
        break
      case 'FileType':
        services.start(args[1])
        break
      case 'BufUnload': {
        await workspace.onBufferUnload(args[1])
        emitter.emit('BufUnload', args[1])
        break
      }
      case 'BufHidden': {
        emitter.emit('BufHidden', args[1])
        break
      }
      case 'BufLeave': {
        emitter.emit('BufLeave', args[1])
        break
      }
      case 'InsertCharPre':
        emitter.emit('InsertCharPre', args[1])
        break
      case 'InsertLeave':
        emitter.emit('InsertLeave')
        break
      case 'InsertEnter':
        emitter.emit('InsertEnter')
        break
      case 'CompleteDone':
        await completion.onCompleteDone(args[1] as VimCompleteItem)
        break
      case 'TextChangedP':
        emitter.emit('TextChangedP')
        break
      case 'TextChangedI':
        emitter.emit('TextChangedI', args[1])
        break
      case 'CursorMoved': {
        diagnosticManager.showMessage()
        break
      }
      case 'CursorMovedI': {
        break
      }
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
          await completion.refreshSource(args[1])
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
        case 'setOption':
          workspace.onOptionChange(args[1], args[2])
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
