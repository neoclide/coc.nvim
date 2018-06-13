import {Plugin, Command, Function, Neovim} from 'neovim'
import {SourceStat, CompleteOption, QueryOption, VimCompleteItem} from './types'
import {
  echoErr,
  isCocItem,
  contextDebounce,
} from './util/index'
import {
  SourceType,
} from './types'
import {
  isWord,
} from './util/string'
import Sources from './sources'
import languages from './languages'
import workspace from './workspace'
import services from './services'
import completes from './completes'
import remoteStore from './remote-store'
import Increment from './increment'
import {serviceMap, supportedTypes} from './source/service'
const logger = require('./util/logger')('index')

@Plugin({dev: false})
export default class CompletePlugin {
  public nvim: Neovim
  public increment: Increment
  private debouncedOnChange: (bufnr: number) => void
  private sources: Sources

  constructor(nvim: Neovim) {
    this.nvim = nvim
    workspace.nvim = nvim
    languages.nvim = nvim
    this.debouncedOnChange = contextDebounce((bufnr: number) => {
      workspace.onBufferChange(bufnr).catch(e => {
        logger.error(e.message)
      })
    }, 100)
    this.increment = new Increment(nvim)
  }

  private onUnhandledError(err: Error): void {
    echoErr(this.nvim, err.stack).catch(() => {
      // noop
    })
    logger.error(err.stack)
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
      this.sources = new Sources(nvim)
      await nvim.command(`let g:coc_node_channel_id=${channelId}`)
      await nvim.command('silent doautocmd User CocNvimInit')
      services.init(nvim)
      logger.info('Coc service Initailized')
      let filetype = await nvim.eval('&filetype') as string
      services.start(filetype)
    } catch (err) {
      logger.error(err.stack)
      return echoErr(nvim, `Initailize failed, ${err.message}`)
    }
  }

  @Function('CocBufCreate', {sync: false})
  public async cocBufCreate(args: any[]): Promise<void> {
    await workspace.onBufferCreate(args[0])
  }

  @Function('CocBufUnload', {sync: false})
  public async cocBufUnload(args: [number]): Promise<void> {
    await workspace.onBufferUnload(args[0])
  }

  @Function('CocBufChange', {sync: false})
  public async cocBufChange(args: any[]): Promise<void> {
    this.debouncedOnChange(args[0])
  }

  @Function('CocBufEnter', {sync: false})
  public async cocBufEnter(args: any[]): Promise<void> {
    let bufnr = Number(args[0])
    await workspace.bufferEnter(bufnr)
  }

  @Function('CocStart', {sync: false})
  public async cocStart(args: [CompleteOption]): Promise<void> {
    let opt = args[0]
    let start = Date.now()
    let {nvim, increment} = this
    // may happen
    await increment.stop()
    logger.debug(`options: ${JSON.stringify(opt)}`)
    let complete = completes.createComplete(opt, false)
    let sources = this.sources.getCompleteSources(opt)
    logger.debug(`Activted sources: ${sources.map(o => o.name).join(',')}`)
    if (!sources || sources.length == 0) return
    complete.doComplete(nvim, sources).then(async items => {
      if (!items || items.length == 0) {
        // no items found
        completes.reset()
        return
      }
      completes.calculateChars(items)
      await increment.start(opt)
      await nvim.setVar('coc#_context', {
        start: opt.col,
        candidates: items
      })
      await nvim.call('coc#_do_complete', [])
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      // if (autoComplete) await this.onAutoComplete(opt, items[0])
    }, this.onUnhandledError)
  }

  @Function('CocInsertCharPre', {sync: true})
  public async cocInsertCharPre(args: any[]): Promise<void> {
    logger.debug('InsertedCharPre')
    await this.increment.onCharInsert(args[0] as string)
  }

  @Function('CocInsertLeave', {sync: false})
  public async cocInsertLeave(): Promise<void> {
    await this.increment.stop()
  }

  @Function('CocCompleteDone', {sync: true})
  public async cocCompleteDone(args: any[]): Promise<void> {
    logger.debug('complete done')
    let {nvim, increment} = this
    let item: VimCompleteItem = args[0]
    // vim would send {} on cancel
    if (!item || Object.keys(item).length == 0) return
    logger.debug(`complete item: ${JSON.stringify(item)}`)
    if (increment.isActivted) {
      logger.debug('complete done with item, increment stopped')
      await increment.stop()
    }
    let isCoc = isCocItem(item)
    if (isCoc && item.user_data) {
      if (item.user_data) {
        let data = JSON.parse(item.user_data)
        let source = this.sources.getSource(data.name)
        if (source && typeof source.onCompleteDone === 'function') {
          await source.onCompleteDone(item)
        }
      }
      completes.addRecent(item.word)
    }
  }

  @Function('CocTextChangedP', {sync: true})
  public async cocTextChangedP(): Promise<void> {
    logger.debug('TextChangedP')
    let {latestTextChangedI} = this.increment
    if (!latestTextChangedI) {
      await this.increment.stop()
    } else {
      // let's find inserted word
    }
  }

  @Function('CocTextChangedI', {sync: true})
  public async cocTextChangedI(args:any): Promise<void> {
    logger.debug('TextchangedI')
    let {nvim, increment} = this
    let character = increment.latestIntertChar
    let shouldResume = await increment.onTextChangedI()
    if (!shouldResume) {
      // check trigger
      if (character) {
        let autoTrigger = workspace.getConfiguration('coc.preferences').get('autoTrigger', 'always')
        if (autoTrigger == 'none') return
        let shouldTrigger = false
        if (isWord(character)) {
          if (autoTrigger == 'trigger') return
          let input = await nvim.call('coc#util#get_input') as string
          shouldTrigger = input.length == 1
        } else {
          let languageId = await nvim.eval('&filetype') as string
          shouldTrigger = this.sources.shouldTrigger(character, languageId)
        }
        if (shouldTrigger) {
          await workspace.onBufferChange(args[0])
          await nvim.call('coc#start', [character])
        }
      }
    } else {
      this.debouncedOnChange(args[0])
      let oldComplete = completes.complete || ({} as {[index: string]: any})
      let opt = Object.assign({}, completes.option, {
        input: increment.search
      })
      let {results} = oldComplete
      if (!results || results.length == 0) {
        await this.increment.stop()
        return
      }
      let start = Date.now()
      logger.debug(`Resume options: ${JSON.stringify(opt)}`)
      let {startcol} = oldComplete
      let complete = completes.createComplete(opt, true)
      let items = complete.filterResults(results, true)
      logger.debug(`Filtered item length: ${items.length}`)
      if (!items || items.length === 0) {
        await increment.stop()
        return
      }
      // character change detect
      if (increment.latestIntertChar === character) {
        await nvim.setVar('coc#_context', {
          start: startcol,
          candidates: items
        })
        await nvim.call('coc#_do_complete', [])
        logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      }
    }
  }

  // callback for remote sources
  @Function('CocResult', {sync: false})
  public async cocResult(args: any[]): Promise<void> {
    let id = Number(args[0])
    let name = args[1] as string
    let items = args[2] as VimCompleteItem[]
    items = items || []
    logger.debug(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  @Function('CocSourceStat', {sync: true})
  public async cocSourceStat(): Promise<SourceStat[]> {
    let res: SourceStat[] = []
    let filetype = await this.nvim.eval('&filetype') as string
    let items = this.sources.getSourcesForFiletype(filetype)
    for (let item of items) {
      res.push({
        name: item.name,
        filepath: item.filepath || '',
        type: item.sourceType == SourceType.Native
              ? 'native' : item.sourceType == SourceType.Remote
              ? 'remote' : 'service',
        disabled: !!item.disabled
      })
    }
    return res
  }

  @Function('CocSourceToggle', {sync: true})
  public async cocSourceToggle(args: any): Promise<string> {
    let name = args[0].toString()
    if (!name) return ''
    let source = this.sources.getSource(name)
    if (!source) return
    if (typeof source.toggle === 'function') {
      source.toggle()
    }
  }

  @Function('CocSourceRefresh', {sync: true})
  public async cocSourceRefresh(args: any): Promise<boolean> {
    let name = String(args[0])
    let source = this.sources.getSource(name)
    if (!source) {
      await echoErr(this.nvim, `Source ${name} not found`) // tslint:disable-line
      return false
    }
    if (typeof source.refresh === 'function') {
      await source.refresh()
    }
    return true
  }

  @Function('CocFileTypeChange', {sync: false})
  public async cocFileTypeChange(args: any): Promise<void> {
    let filetype = args[0] as string
    services.start(filetype)
  }

  @Function('CocJumpDefinition', {sync: true})
  public async cocJumpDefninition(): Promise<void> {
    // TODO
  }
}
