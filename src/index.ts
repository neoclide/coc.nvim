import {Plugin, Command, Function, Neovim} from 'neovim'
import {SourceStat, CompleteOption, QueryOption, VimCompleteItem} from './types'
import {
  echoErr,
  isCocItem,
  contextDebounce,
  wait,
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
  private completionInitialing = false
  private completeItems:VimCompleteItem[] = []

  constructor(nvim: Neovim) {
    this.nvim = nvim
    workspace.nvim = nvim
    languages.nvim = nvim
    this.debouncedOnChange = contextDebounce((bufnr: number) => {
      workspace.onBufferChange(bufnr).catch(e => {
        logger.error(e.message)
      })
    }, 100)
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
      let buffer = await nvim.buffer
      let srcId = await buffer.addHighlight({line: 0, srcId: 0})
      this.increment = new Increment(nvim, srcId)
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
    try {
      await this.startCompletion(args[0])
    } catch (e) {
      await echoErr(this.nvim, e.message)
      logger.error('Error happens on complete', e.stack)
    }
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
    let item: VimCompleteItem = args[0]
    logger.debug('complete done:', item)
    if (!isCocItem(item)) return
    let {increment} = this
    if (increment.isActivted) {
      logger.debug('complete done with coc item, increment stopped')
      await increment.stop()
    }
    completes.addRecent(item.word)
    await this.sources.doCompleteDone(item)
    this.completeItems = []
  }

  @Function('CocTextChangedP', {sync: false})
  public async cocTextChangedP(): Promise<void> {
    let {latestTextChangedI} = this.increment
    let {nvim, increment} = this
    if (!latestTextChangedI) {
      await this.increment.stop()
      let candidates = this.completeItems
      if (candidates.length == 0) return
      let input = await this.nvim.call('coc#util#get_input')
      if (input.length < 2) return
      let item = candidates.find(o => o.word === input)
      if (item) await this.sources.doCompleteResolve(item)
    }
  }

  @Function('CocTextChangedI', {sync: false})
  public async cocTextChangedI(args:any): Promise<void> {
    logger.debug('TextchangedI')
    let {nvim, increment} = this
    let bufnr = Number(args[0])
    let character = increment.lastInsertChar
    if (increment.isActivted) {
      let shouldResume = await increment.shouldCompletionResume()
      if (shouldResume) {
        try {
          let resumed = await this.resumeCompletion(bufnr, character)
          if (resumed) return
        } catch (e) {
          logger.error('Error happens on resume completion', e.stack)
        }
      }
    }
    await nvim.call('coc#_hide')
    await increment.stop()
    let shouldTrigger = await this.shouldTrigger()
    if (!shouldTrigger) return
    await workspace.onBufferChange(bufnr)
    let option = await nvim.call('coc#util#get_complete_option')
    Object.assign(option, { triggerCharacter: character })
    logger.debug('trigger completion with', option)
    try {
      await this.startCompletion(option)
    } catch (e) {
      logger.error('Error happens on trigger completion', e.stack)
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

  private async shouldTrigger():Promise<boolean> {
    let {nvim, increment, sources} = this
    let character = increment.lastInsertChar
    if (!character) return false
    let autoTrigger = workspace.getConfiguration('coc.preferences').get('autoTrigger', 'always')
    if (autoTrigger == 'none') return false
    if (isWord(character)) {
      let input = await nvim.call('coc#util#get_input') as string
      return input.length == 1
    } else {
      let buffer = await nvim.buffer
      let languageId = await buffer.getOption('filetype') as string
      return sources.shouldTrigger(character, languageId)
    }
    return false
  }

  private async resumeCompletion(bufnr:number, character:string):Promise<boolean> {
    let {increment, nvim} = this
    this.debouncedOnChange(bufnr)
    let oldComplete = completes.complete
    let opt = Object.assign({}, oldComplete.option, {
      input: increment.search
    })
    let start = Date.now()
    logger.debug(`Resume options: ${JSON.stringify(opt)}`)
    let complete = completes.createComplete(opt, true)
    let items = complete.filterResults(oldComplete.results, true)
    logger.debug(`Filtered item length: ${items.length}`)
    this.completeItems = items
    if (!items || items.length === 0) {
      return false
    }
    await nvim.call('coc#_set_context', [opt.col, items])
    await nvim.call('coc#_do_complete', [])
    logger.debug(`Complete time cost: ${Date.now() - start}ms`)
    return true
  }

  private async startCompletion(opt: CompleteOption): Promise<void> {
    if (this.completionInitialing) return
    this.completionInitialing = true
    let start = Date.now()
    let {nvim, increment} = this
    // could happen for auto trigger
    await increment.stop()
    logger.debug(`options: ${JSON.stringify(opt)}`)
    let complete = completes.createComplete(opt, false)
    let sources = this.sources.getCompleteSources(opt)
    logger.debug(`Activted sources: ${sources.map(o => o.name).join(',')}`)
    complete.doComplete(nvim, sources).then(async items => {
      this.completeItems = items
      if (items.length == 0) {
        // no items found
        completes.reset()
        this.completionInitialing = false
        return
      }
      completes.calculateChars(items)
      await increment.start(opt)
      await nvim.call('coc#_set_context', [opt.col, items])
      logger.debug(items.length)
      await nvim.call('coc#_do_complete', [])
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      await wait(10)
      this.completionInitialing = false
      // fix that user input during popup shown
      if (!increment.isActivted) {
        await this.nvim.call('coc#_hide')
      }
    }, this.onUnhandledError)
  }
}
