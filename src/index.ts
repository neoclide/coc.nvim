// umask is blacklisted by node-client
process.umask = ()=> {
  return 18
}
import { Plugin, Function, Neovim } from 'neovim'
import {
  SourceStat,
  CompleteOption,
  VimCompleteItem} from './types'
import {
  wait,
  echoErr,
  isCocItem,
  contextDebounce} from './util/index'
import {
  setConfig,
  toggleSource,
  shouldAutoComplete,
  getConfig} from './config'
import buffers from './buffers'
import completes from './completes'
import remotes from './remotes'
import natives from './natives'
import remoteStore from './remote-store'
import Increment from './increment'
const logger = require('./util/logger')('index')

@Plugin({dev: false})
export default class CompletePlugin {
  public nvim: Neovim
  public increment: Increment
  private debouncedOnChange: (bufnr: string)=>void

  constructor(nvim: Neovim) {
    this.nvim = nvim
    this.debouncedOnChange = contextDebounce((bufnr: number) => {
      this.onBufferChange(bufnr).catch(e => {
        logger.error(e.message)
      })
      logger.debug(`buffer ${bufnr} change`)
    }, 500)
    this.increment = new Increment(nvim)
    this.handleError = this.handleError.bind(this)
    process.on('unhandledRejection', (reason, p) => {
      logger.error('Unhandled Rejection at:', p, 'reason:', reason)
      if (reason instanceof Error) this.handleError(reason)
    })
    process.on('uncaughtException', this.handleError)
  }

  private handleError(err: Error):void {
    let {nvim} = this
    echoErr(nvim ,`Service error: ${err.message}`).catch(err => {
      logger.error(err.message)
    })
  }

  @Function('CocInitAsync', {sync: false})
  public async cocInitAsync():Promise<void> {
    this.onInit().catch(err => {
      logger.error(err.stack)
    })
  }

  @Function('CocInitSync', {sync: true})
  public async cocInitSync():Promise<void> {
    await this.onInit()
  }

  private async onInit(): Promise<void> {
    let {nvim} = this
    try {
      await this.initConfig()
      await natives.init()
      await remotes.init(nvim, natives.names)
      await nvim.command(`let g:coc_node_channel_id=${(nvim as any)._channel_id}`)
      await nvim.command('silent doautocmd User CocNvimInit')
      logger.info('Coc service Initailized')
      // required since BufRead triggered before VimEnter
      let bufs:number[] = await nvim.call('coc#util#get_buflist', [])
      for (let buf of bufs) {
        await buffers.addBuffer(nvim, buf)
      }
    } catch (err) {
      logger.error(err.stack)
      return echoErr(nvim, `Initailize failed, ${err.message}`)
    }
  }

  @Function('CocBufUnload', {sync: false})
  public async cocBufUnload(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    buffers.removeBuffer(bufnr)
    logger.debug(`buffer ${bufnr} remove`)
  }

  @Function('CocBufChange', {sync: false})
  public async cocBufChange(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    this.debouncedOnChange(bufnr)
  }

  @Function('CocStart', {sync: false})
  public async cocStart(args: [CompleteOption]):Promise<void> {
    let opt = args[0]
    let start = Date.now()
    let {nvim, increment} = this
    // may happen
    await increment.stop()
    logger.debug(`options: ${JSON.stringify(opt)}`)
    let {filetype} = opt
    let complete = completes.createComplete(opt)
    let sources = await completes.getSources(nvim, filetype)
    complete.doComplete(sources).then(async ([startcol, items])=> {
      if (items.length == 0) {
        // no items found
        completes.reset()
        return
      }
      let autoComplete = items.length == 1 && shouldAutoComplete()
      if (!autoComplete) {
        await increment.start(opt)
      }
      await nvim.setVar('coc#_context', {
        start: startcol,
        candidates: items
      })
      await nvim.call('coc#_do_complete', [])
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      completes.calculateChars()
      this.onCompleteStart(opt, autoComplete, items).catch(this.handleError)
    }, this.handleError)
  }

  private async onCompleteStart(opt:CompleteOption, autoComplete:boolean, items:VimCompleteItem[]):Promise<void> {
    let {nvim} = this
    await wait(20)
    let visible = await nvim.call('pumvisible')
    if (!autoComplete && !visible) {
      // TODO find out the way to trigger completeDone
      // if no way to trigger completeDone, handle it here
    }
  }

  @Function('CocInsertCharPre', {sync: false})
  public async cocInsertCharPre(args: any[]):Promise<void> {
    logger.debug(555)
    // await this.increment.onCharInsert(args[0] as string)
  }

  @Function('CocCompleteDone', {sync: true})
  public async cocCompleteDone(args: any[]):Promise<void> {
    logger.debug('complete done')
    let {nvim, increment} = this
    let item:VimCompleteItem = args[0]
    if (!item || Object.keys(item).length == 0) item = null
    let isCoc = isCocItem(item)
    logger.debug(`complete item:${JSON.stringify(item)}`)
    if (increment.activted) {
      await increment.onCompleteDone(item, isCoc)
    }
    if (item && isCoc) {
      completes.addRecent(item.word)
      if (item.user_data) {
        let data = JSON.parse(item.user_data)
        let source = await completes.getSource(nvim, data.source)
        if (source) {
          await source.onCompleteDone(item)
        }
      }
    }
  }

  @Function('CocTextChangedP', {sync: true})
  public async cocTextChangedP():Promise<void> {
    logger.debug('TextChangedP')
    let {latestTextChangedI} = this.increment
    if (!latestTextChangedI) {
      await this.increment.stop()
      // navigation change
    }
  }

  @Function('CocTextChangedI', {sync: true})
  public async cocTextChangedI():Promise<void> {
    let {complete} = completes
    let {nvim, increment} = this
    if (!complete) return
    let shouldStart = await increment.onTextChangedI()
    if (shouldStart) {
      let {input, option} = increment
      let opt = Object.assign({}, option, {
        input: input.search
      })
      let oldComplete = completes.complete || ({} as {[index:string]:any})
      let {results} = oldComplete
      if (!results || results.length == 0) {
        await increment.stop()
        return
      }
      let start = Date.now()
      logger.debug(`Resume options: ${JSON.stringify(opt)}`)
      let {startcol, icase} = oldComplete
      let complete = completes.newComplete(opt)
      let items = complete.filterResults(results, icase)
      logger.debug(`Filtered items:${JSON.stringify(items)}`)
      if (!items || items.length === 0) {
        await increment.stop()
        return
      }
      let autoComplete = items.length == 1 && shouldAutoComplete()
      if (autoComplete) {
        // let vim complete it
        await increment.stop()
      }
      await nvim.setVar('coc#_context', {
        start: startcol,
        candidates: items
      })
      await nvim.call('coc#_do_complete', [])
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      this.onCompleteStart(opt, autoComplete, items).catch(this.handleError)
    }
  }

  // callback for remote sources
  @Function('CocResult', {sync: false})
  public async cocResult(args: any[]):Promise<void> {
    let id = Number(args[0])
    let name = args[1] as string
    let items = args[2] as VimCompleteItem[]
    items = items || []
    logger.debug(`Remote ${name} result count: ${items.length}`)
    remoteStore.setResult(id, name, items)
  }

  // Used for :checkhealth
  @Function('CocCheck', {sync: true})
  public async cocCheck():Promise<string[] | null> {
    let {nvim} = this
    await remotes.init(nvim, natives.names, true)
    let {names} = remotes
    let success = true
    for (let name of names) {
      let source = remotes.createSource(nvim, name, true)
      if (source == null) {
        success = false
      }
    }
    return success ? names: null
  }

  @Function('CocSourceStat', {sync: true})
  public async cocSourceStat():Promise<SourceStat[]> {
    let disabled = getConfig('disabled')
    let res: SourceStat[] = []
    let items:any = natives.list.concat(remotes.list as any)
    for (let item of items) {
      let {name, filepath} = item
      res.push({
        name,
        type: natives.has(name) ? 'native' : 'remote',
        disabled: disabled.indexOf(name) !== -1,
        filepath
      })
    }
    return res
  }

  @Function('CocSourceToggle', {sync: true})
  public async cocSourceToggle(args: any):Promise<string> {
    let name = args[0].toString()
    if (!name) return ''
    if (!natives.has(name) && !remotes.has(name)) {
      await echoErr(this.nvim, `Source ${name} not found`)
      return ''
    }
    return toggleSource(name)
  }

  @Function('CocSourceRefresh', {sync: true})
  public async cocSourceRefresh(args: any):Promise<boolean> {
    let name = args[0].toString()
    if (name) {
      let m = natives.has(name) ? natives : remotes
      let source = await m.getSource(this.nvim, name)
      if (!source) {
        await echoErr(this.nvim, `Source ${name} not found`)
        return false
      }
      await source.refresh()
    } else {
      for (let m of [remotes, natives]) {
        for (let s of m.sources) {
          if (s) {
            await s.refresh()
          }
        }
      }
    }
    return true
  }

  private async onBufferChange(bufnr: number):Promise<void> {
    let listed = await this.nvim.call('getbufvar', [Number(bufnr), '&buflisted'])
    if (listed) await buffers.addBuffer(this.nvim, bufnr)
  }

  private async initConfig(): Promise<void> {
    let {nvim} = this
    let opts: {[index: string]: any} = await nvim.call('coc#get_config', [])
    setConfig(opts)
  }
}
