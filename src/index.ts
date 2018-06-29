import {Function, Neovim, Plugin} from 'neovim'
import commands from './commands'
import completion from './completion'
import diagnosticManager from './diagnostic/manager'
import Handler from './handler'
import languages from './languages'
import remoteStore from './remote-store'
import services from './services'
import snippetManager from './snippet/manager'
import {VimCompleteItem} from './types'
import {echoErr} from './util'
import workspace from './workspace'
import Emitter = require('events')
const logger = require('./util/logger')('index')

@Plugin({dev: false})
export default class CompletePlugin {
  private initialized = false
  private emitter: Emitter
  private handler: Handler

  constructor(public nvim: Neovim) {
    this.emitter = new Emitter()
    this.handler = new Handler(nvim)
    workspace.nvim = nvim
    languages.nvim = nvim
    snippetManager.init(nvim)
    commands.init(nvim)
  }

  @Function('CocInitAsync', {sync: false})
  public async cocInitAsync (): Promise<void> {
    this.onInit().catch(err => {
      logger.error(err.stack)
    })
  }

  @Function('CocInitSync', {sync: true})
  public async cocInitSync (): Promise<void> {
    await this.onInit()
  }

  private async onInit (): Promise<void> {
    let {nvim} = this
    try {
      let channelId = await (nvim as any).channelId
      // workspace configuration
      await workspace.init()
      completion.init(nvim, this.emitter)
      await nvim.command(`let g:coc_node_channel_id=${channelId}`)
      await nvim.command('silent doautocmd User CocNvimInit')
      services.init(nvim)
      this.initialized = true
      logger.info('Coc service Initialized')
      let filetype = await nvim.eval('&filetype') as string
      services.start(filetype)
    } catch (err) {
      logger.error(err.stack)
      return echoErr(nvim, `Initialize failed, ${err.message}`)
    }
  }

  // callback for remote sources
  @Function('CocResult', {sync: false})
  public async cocResult (args: [number, string, VimCompleteItem[]]): Promise<void> {
    let [id, name, items] = args
    id = Number(id)
    items = items || []
    logger.trace(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  @Function('CocAutocmd', {sync: true})
  public async cocAutocmd (args: any): Promise<void> {
    let {emitter} = this
    logger.trace('Autocmd:', args[0])
    switch (args[0] as string) {
      case 'TextChanged':
        emitter.emit('TextChanged', Date.now())
        break
      case 'BufEnter':
        await workspace.bufferEnter(args[1])
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
        // wait for workspace notification
        setTimeout(() => {
          emitter.emit('TextChangedI')
        }, 20)
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

  @Function('CocAction', {sync: true})
  public async cocAction (args: any): Promise<any> {
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
        case 'services':
          return services.getServiceStats()
        case 'restartService':
          return services.restart(args[1])
        case 'codeAction':
          return handler.doCodeAction(args[1])
        default:
          logger.error(`unknown action ${args[0]}`)
      }
    } catch (e) {
      logger.error(e.stack)
    }
  }
}
