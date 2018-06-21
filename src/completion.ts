import {Neovim} from 'neovim'
import {
  echoErr,
  isCocItem,
} from './util'
import {
  isWord,
} from './util/string'
import {
  CompleteOption,
  VimCompleteItem,
  SourceStat,
  SourceType
} from './types'
import {
  TextDocument,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol'
import EventEmitter = require('events')
import workspace from './workspace'
import Sources from './sources'
import completes from './completes'
import Increment from './increment'
import snippetManager from './snippet/manager'
import Document from './model/document'
const logger = require('./util/logger')('completion')

export class Completion {
  private increment: Increment
  private sources: Sources
  private lastChangedI: number
  private nvim:Neovim

  constructor() {
    this.onError = this.onError.bind(this)
  }

  public init(nvim, emitter:EventEmitter):void {
    this.nvim = nvim
    let increment = this.increment = new Increment(nvim)
    this.sources = new Sources(nvim)
    emitter.on('InsertCharPre', character => {
      this.onInsertCharPre(character)
    })
    emitter.on('InsertLeave', () => {
      this.onInsertLeave()
    })
    emitter.on('CompleteDone', item => {
      this.onCompleteDone(item).catch(this.onError)
    })
    emitter.on('TextChangedP', () => {
      this.onTextChangedP().catch(this.onError)
    })
    emitter.on('TextChangedI', () => {
      this.onTextChangedI().catch(this.onError)
    })

    let document:Document = null
    increment.on('start', option => {
      let {bufnr} = option
      document = workspace.getDocument(bufnr)
      if (document) document.paused = true
    })
    increment.on('stop', () => {
      if (!document) return
      document.paused = false
    })
  }

  public get hasLatestChangedI():boolean {
    let {lastChangedI} = this
    return lastChangedI && Date.now() - lastChangedI < 30
  }

  private onError(err):void {
    logger.error(err.stack)
  }

  public startCompletion(option: CompleteOption):void {
    this._doComplete(option).catch(e => {
      echoErr(this.nvim, e.message).catch(this.onError)
      logger.error('Error happens on complete: ', e.stack)
    })
  }

  public async resumeCompletion(resumeInput:string):Promise<void> {
    let {nvim, increment} = this
    let oldComplete = completes.complete
    try {
      let {colnr, input} = oldComplete.option
      let opt = Object.assign({}, oldComplete.option, {
        input: resumeInput,
        colnr: colnr + resumeInput.length - input.length
      })
      logger.debug(`Resume options: ${JSON.stringify(opt)}`)
      let items = completes.filterCompleteItems(opt)
      logger.debug(`Filtered item length: ${items.length}`)
      if (!items || items.length === 0) {
        increment.stop()
        return
      }
      if (increment.search == resumeInput) {
        await nvim.call('coc#_set_context', [opt.col, items])
        await nvim.call('coc#_do_complete')
      } else {
        logger.debug('input change, skip increment')
      }
    } catch (e) {
      await echoErr(nvim, `completion error: ${e.message}`)
      logger.error(e.stack)
    }
  }

  public toggleSource(name:string):void {
    if (!name) return
    let source = this.sources.getSource(name)
    if (!source) return
    if (typeof source.toggle === 'function') {
      source.toggle()
    }
  }

  public async refreshSource(name:string):Promise<void> {
    let source = this.sources.getSource(name)
    if (!source) return
    if (typeof source.refresh === 'function') {
      await source.refresh()
    }
  }

  public async sourceStat():Promise<SourceStat[]> {
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

  private async _doComplete(option: CompleteOption):Promise<void> {
    if (completes.completing) return
    let {nvim, increment} = this
    // could happen for auto trigger
    increment.start(option)
    logger.debug(`options: ${JSON.stringify(option)}`)
    let sources = this.sources.getCompleteSources(option)
    logger.debug(`Activted sources: ${sources.map(o => o.name).join(',')}`)
    let items = await completes.doComplete(nvim, sources, option)
    if (items.length == 0) {
      increment.stop()
      return
    }
    let {search} = increment
    if (search === option.input) {
      await nvim.call('coc#_set_context', [option.col, items])
      await nvim.call('coc#_do_complete')
    } else {
      logger.debug('input change, try resume')
      if (search && completes.hasMatch(search)) {
        await this.resumeCompletion(search)
      } else {
        increment.stop()
      }
    }
  }

  private async onTextChangedP():Promise<void> {
    let {increment} = this
    if (increment.latestInsert) {
      if (!increment.isActivted) return
      let search = await increment.getResumeInput()
      if (search) await this.resumeCompletion(search)
      return
    }
    if (completes.completing) return
    if (this.hasLatestChangedI) return
    let {option} = completes
    let search = await this.nvim.call('coc#util#get_search', [option.col])
    let item = completes.getCompleteItem(search)
    if (item) await this.sources.doCompleteResolve(item)
  }

  private async onTextChangedI():Promise<void> {
    this.lastChangedI = Date.now()
    let {nvim, increment} = this
    let {latestInsertChar} = increment
    if (increment.isActivted) {
      let search = await increment.getResumeInput()
      if (search) await this.resumeCompletion(search)
    }
    if (increment.isActivted || !latestInsertChar) return
    // check trigger
    let shouldTrigger = await this.shouldTrigger(latestInsertChar)
    if (!shouldTrigger) return
    let option = await nvim.call('coc#util#get_complete_option')
    Object.assign(option, { triggerCharacter: latestInsertChar })
    logger.debug('trigger completion with', option)
    this.startCompletion(option)
  }

  private async onCompleteDone(item:VimCompleteItem):Promise<void> {
    if (!isCocItem(item)) return
    let {increment} = this
    if (increment.isActivted) {
      logger.debug('complete done with coc item, increment stopped')
      increment.stop()
    }
    completes.addRecent(item.word)
    await this.sources.doCompleteDone(item)
    completes.reset()
  }

  private onInsertLeave():void {
    this.nvim.call('coc#_hide').catch(e => {
      // noop
    })
    this.increment.stop()
  }

  private onInsertCharPre(character:string):void {
    let {increment, nvim} = this
    increment.lastInsert = {
      character,
      timestamp: Date.now(),
    }
  }

  private async shouldTrigger(character:string):Promise<boolean> {
    if (!character || character == ' ') return false
    let {nvim, sources} = this
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
}

export default new Completion()
