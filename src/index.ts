import {Plugin, Function, Neovim} from 'neovim'
import {VimCompleteItem} from './types'
import {
  echoErr,
} from './util'
import snippetManager from './snippet/manager'
import completion from './completion'
import workspace from './workspace'
import services from './services'
import remoteStore from './remote-store'
import languages from './languages'
import commands from './commands'
import diagnosticManager from './diagnostic/manager'
import EventEmitter = require('events')
import Handler from './handler'
const logger = require('./util/logger')('index')

@Plugin({dev: false})
export default class CompletePlugin {
  private initailized = false
  private emitter: EventEmitter
  private handler: Handler

  constructor(public nvim: Neovim) {
    this.emitter = new EventEmitter()
    this.handler = new Handler(nvim)
    workspace.nvim = nvim
    languages.nvim = nvim
    snippetManager.init(nvim)
    commands.init(nvim)
  }

  @Function('CocInitAsync', {sync: false})
  public async cocInitAsync(): Promise<void> {
    this.onInit().catch(err => {
      logger.error(err.stack)
    })
  }

  @Function('CocInitSync', {sync: true})
  public async cocInitSync(): Promise<void> {
    await this.onInit()
  }

  private async onInit(): Promise<void> {
    let {nvim} = this
    try {
      let channelId = await (nvim as any).channelId
      // workspace configuration
      await workspace.init()
      completion.init(nvim, this.emitter)
      await nvim.command(`let g:coc_node_channel_id=${channelId}`)
      await nvim.command('silent doautocmd User CocNvimInit')
      services.init(nvim)
      this.initailized = true
      logger.info('Coc service Initailized')
      let filetype = await nvim.eval('&filetype') as string
      services.start(filetype)
    } catch (err) {
      logger.error(err.stack)
      return echoErr(nvim, `Initailize failed, ${err.message}`)
    }
  }

  // callback for remote sources
  @Function('CocResult', {sync: false})
  public async cocResult(args: [number, string, VimCompleteItem[]]): Promise<void> {
    let [id, name, items] = args
    id = Number(id)
    items = items || []
    logger.trace(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  @Function('CocAutocmd', {sync: true})
  public async cocAutocmd(args: any): Promise<void> {
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
        logger.debug('completeDone')
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
  public async cocAction(args: any): Promise<any> {
    if (!this.initailized) return
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
        default:
          logger.error(`unknown action ${args[0]}`)
      }
    } catch (e) {
      logger.error(e.stack)
    }
  }
}
