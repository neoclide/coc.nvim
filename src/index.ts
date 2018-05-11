// umask is blacklisted by node-client
process.umask = ()=> {
  return 18
}
import { Plugin, Autocmd, Function, Neovim } from 'neovim'
import {
  SourceStat,
  SourceConfig,
  CompleteOption,
  VimCompleteItem} from './types'
import {echoErr, contextDebounce} from './util/index'
import {
  setConfig,
  toggleSource,
  configSource,
  getConfig} from './config'
import debounce = require('debounce')
import buffers from './buffers'
import completes from './completes'
import remotes from './remotes'
import natives from './natives'
import fundebug = require('fundebug-nodejs')
import remoteStore from './remote-store'
import increment from './increment'
const logger = require('./util/logger')('index')
fundebug.apikey='08fef3f3304dc6d9acdb5568e4bf65edda6bf3ce41041d40c60404f16f72b86e'

@Plugin({dev: true})
export default class CompletePlugin {
  public nvim: Neovim
  private debouncedOnChange: (bufnr: string)=>void

  constructor(nvim: Neovim) {
    this.nvim = nvim
    this.debouncedOnChange = contextDebounce((bufnr: string) => {
      this.onBufferChange(bufnr).catch(e => {
        logger.error(e.message)
      })
      logger.debug(`buffer ${bufnr} change`)
    }, 500)

    process.on('unhandledRejection', (reason, p) => {
      logger.error('Unhandled Rejection at:', p, 'reason:', reason)
      if (reason instanceof Error) this.handleError(reason)
    })
    process.on('uncaughtException', this.handleError)
  }

  private handleError(err: Error):void {
    let {nvim} = this
    echoErr(nvim ,`Service error: ${err.message}`).catch(err => { logger.error(err.message)
    })
    if (getConfig('traceError') && process.env.NODE_ENV !== 'test') {
      // fundebug.notifyError(err)
    }
  }

  @Autocmd('VimEnter', {
    sync: false,
    pattern: '*'
  })
  public async onVimEnter(): Promise<void> {
    let {nvim} = this
    try {
      await this.initConfig()
      await natives.init()
      await remotes.init(nvim, natives.names)
      await nvim.command(`let g:complete_node_channel_id=${(nvim as any)._channel_id}`)
      await nvim.command('silent doautocmd User CompleteNvimInit')
      logger.info('Complete service Initailized')
      // required since BufRead triggered before VimEnter
      let bufs:number[] = await nvim.call('complete#util#get_buflist', [])
      for (let buf of bufs) {
        await buffers.addBuffer(nvim, buf.toString())
      }
    } catch (err) {
      logger.error(err.stack)
      return echoErr(nvim, `Initailize failed, ${err.message}`)
    }
  }

  @Function('CompleteBufUnload', {sync: false})
  public async onBufUnload(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    buffers.removeBuffer(bufnr)
    logger.debug(`buffer ${bufnr} remove`)
  }

  @Function('CompleteBufChange', {sync: false})
  public async onBufChange(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    this.debouncedOnChange(bufnr)
  }

  @Function('CompleteStart', {sync: false})
  public async completeStart(args: [CompleteOption]):Promise<void> {
    let opt = args[0]
    let start = Date.now()
    if (!opt) return
    logger.debug(`options: ${JSON.stringify(opt)}`)
    let {filetype, col} = opt
    let complete = completes.createComplete(opt)
    let sources = await completes.getSources(this.nvim, filetype)
    complete.doComplete(sources).then(([startcol, items])=> {
      if (items.length == 0) {
        // no items found
        completes.reset()
        return
      }
      completes.firstItem = items[0]
      if (items.length > 1) {
        increment.setOption(opt)
      }
      this.nvim.setVar('complete#_context', {
        start: startcol,
        candidates: items
      })
      this.nvim.call('complete#_do_complete', []).then(() => {
        logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      })
    })
  }

  @Autocmd('InsertCharPre', {
    pattern: '*',
    sync: true,
  })
  public async completeCharInsert():Promise<void> {
    await increment.onCharInsert(this.nvim)
  }

  @Autocmd('CompleteDone', {
    pattern: '*',
    sync: true,
  })
  public async completeDone():Promise<void> {
    await increment.onComplete(this.nvim)
  }

  @Autocmd('InsertLeave', {
    pattern: '*',
    sync: true,
  })
  public async completeLeave():Promise<void> {
    await increment.stop(this.nvim)
  }

  @Autocmd('TextChangedI', {
    pattern: '*',
    sync: true
  })
  public async completeTextChangeI():Promise<void> {
    let {complete} = completes
    let {nvim} = this
    if (!complete) return
    let shouldStart = await increment.onTextChangeI(nvim)
    if (shouldStart) {
      if (!increment.activted) return
      let {input, option, changedI} = increment
      let opt = Object.assign({}, option, {
        changedtick: changedI.changedtick,
        input: input.input
      })
      let oldComplete = completes.complete || ({} as {[index:string]:any})
      let {results} = oldComplete
      if (!results || results.length == 0) {
        await increment.stop(nvim)
        return
      }

      let start = Date.now()
      logger.debug(`Resume options: ${JSON.stringify(opt)}`)
      let {startcol, icase} = oldComplete
      let complete = completes.newComplete(opt)
      let items = complete.filterResults(results, icase)
      logger.debug(`Filtered items:${JSON.stringify(items)}`)
      if (!items || items.length === 0) {
        await increment.stop(nvim)
        return
      }
      if (items.length == 1) {
        await increment.stop(nvim)
      }
      nvim.setVar('complete#_context', {
        start: startcol,
        candidates: items
      })
      nvim.call('complete#_do_complete', []).then(() => {
        logger.debug(`Complete time cost: ${Date.now() - start}ms`)
      })
    }
  }

  @Function('CompleteResult', {sync: false})
  public async completeResult(args: any[]):Promise<void> {
    let id = Number(args[0])
    let name = args[1] as string
    let items = args[2] as VimCompleteItem[]
    items = items || []
    remoteStore.setResult(id, name, items)
  }

  @Function('CompleteCheck', {sync: true})
  public async completeCheck():Promise<string[] | null> {
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

  @Function('CompleteSourceStat', {sync: true})
  public async completeSourceStat():Promise<SourceStat[]> {
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

  @Function('CompleteSourceConfig', {sync: false})
  public async completeSourceConfig(args: any):Promise<void> {
    let name:string = args[0]
    let config:SourceConfig = args[1]
    if (!name) return
    configSource(name, config)
  }

  @Function('CompleteSourceToggle', {sync: true})
  public async completeSourceToggle(args: any):Promise<string> {
    let name = args[0].toString()
    if (!name) return ''
    if (!natives.has(name) && !remotes.has(name)) {
      await echoErr(this.nvim, `Source ${name} not found`)
      return ''
    }
    return toggleSource(name)
  }

  @Function('CompleteSourceRefresh', {sync: true})
  public async completeSourceRefresh(args: any):Promise<boolean> {
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

  private async onBufferChange(bufnr: string):Promise<void> {
    let listed = await this.nvim.call('getbufvar', [Number(bufnr), '&buflisted'])
    if (listed) await buffers.addBuffer(this.nvim, bufnr)
  }

  private async initConfig(): Promise<void> {
    let {nvim} = this
    let opts: {[index: string]: any} = await nvim.call('complete#get_config', [])
    setConfig(opts)
  }
}
