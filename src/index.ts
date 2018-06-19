import {Plugin, Function, Neovim} from 'neovim'
import {VimCompleteItem} from './types'
import {
  echoErr,
  contextDebounce,
} from './util'
import snippetManager from './snippet/manager'
import completion from './completion'
import workspace from './workspace'
import services from './services'
import remoteStore from './remote-store'
import languages from './languages'
import EventEmitter = require('events')
const logger = require('./util/logger')('index')

@Plugin({dev: false})
export default class CompletePlugin {
  public nvim: Neovim
  private debouncedOnChange: (bufnr: number) => void
  private initailized = false
  private emitter: EventEmitter

  constructor(nvim: Neovim) {
    this.nvim = nvim
    this.emitter = new EventEmitter()
    workspace.nvim = nvim
    languages.nvim = nvim
    snippetManager.init(nvim, this.emitter)
    this.debouncedOnChange = contextDebounce((bufnr: number) => {
      workspace.onBufferChange(bufnr).catch(e => {
        logger.error(e.message)
      })
    }, 100)
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
    logger.debug(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  @Function('CocAutocmd', {sync: true})
  public async cocAutocmd(args: any): Promise<void> {
    let {emitter, nvim} = this
    switch (args[0] as string) {
      case 'TextChanged':
        this.debouncedOnChange(args[1])
        emitter.emit('TextChanged')
        break
      case 'BufEnter':
        await workspace.bufferEnter(args[1])
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
        logger.debug('InsertCharPre')
        emitter.emit('InsertCharPre', args[1])
        break
      case 'InsertLeave':
        emitter.emit('InsertLeave')
        break
      case 'InsertEnter':
        emitter.emit('InsertEnter')
        break
      case 'CompleteDone':
        logger.debug('CompleteDone')
        emitter.emit('CompleteDone', args[1])
        break
      case 'TextChangedP':
        logger.debug('TextChangedP')
        emitter.emit('TextChangedP')
        break
      case 'TextChangedI':
        logger.debug('TextChangedI')
        let buffer = await nvim.buffer
        workspace.onBufferChange(buffer.id).then(() => {
          emitter.emit('TextChangedI')
        }, err => {
          logger.error(err.stack)
        })
        break
    }
  }

  @Function('CocAction', {sync: true})
  public async cocAction(args: any): Promise<any> {
    if (!this.initailized) return
    switch (args[0] as string) {
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
    }
  }
}
