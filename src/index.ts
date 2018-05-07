/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Plugin, Autocmd, Function, Neovim } from 'neovim'
import {CompleteOptionVim, VimCompleteItem} from './types'
import {logger} from './util/logger'
import {echoErr, contextDebounce} from './util/index'
import {setConfig, getConfig} from './config'
import debounce = require('debounce')
import buffers from './buffers'
import completes from './completes'
import remoteStore from './remote-store'
import remotes from './remotes'

import fundebug = require('fundebug-nodejs')
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
      if (reason instanceof Error) {
        nvim.call('complete#util#print_errors', [(reason as Error).stack.split(/\n/)]).catch(err => {
          logger.error(err.message)
        })
        if (!getConfig('noTrace') && process.env.NODE_ENV !== 'test') {
          // fundebug.notifyError(reason)
        }
      }
    })

    process.on('uncaughtException', err => {
      echoErr(nvim, err.message)
      logger.error(err.stack)
      if (!getConfig('noTrace') && process.env.NODE_ENV !== 'test') {
        // fundebug.notifyError(err)
      }
    })
  }

  @Autocmd('VimEnter', {
    sync: false,
    pattern: '*'
  })
  public async onVimEnter(): Promise<void> {
    let {nvim} = this
    try {
      await this.initConfig()
      await remotes.init(nvim)
      await nvim.command('let g:complete_node_initailized=1')
      await nvim.command('silent doautocmd User CompleteNvimInit')
      logger.info('Complete service Initailized')
      // required since BufRead triggered before VimEnter
      let bufs:number[] = await nvim.call('complete#util#get_buflist', [])
      for (let buf of bufs) {
        this.debouncedOnChange(buf.toString())
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
  public async completeStart(args: CompleteOptionVim[]):Promise<void> {
    let opt = args[0]
    let start = Date.now()
    if (!opt) return
    logger.debug(`options: ${JSON.stringify(opt)}`)
    let {filetype, col} = opt
    let complete = completes.createComplete(opt)
    let sources = await completes.getSources(this.nvim, filetype)
    complete.doComplete(sources).then(items => {
      if (items === null) items = []
      logger.debug(`items: ${JSON.stringify(items, null, 2)}`)
      if (items.length > 0) {
        this.nvim.setVar('complete#_context', {
          start: col,
          candidates: items
        })
        this.nvim.call('complete#_do_complete', []).then(() => {
          logger.debug(`Complete time cost: ${Date.now() - start}ms`)
        })
      }
    })
  }

  @Autocmd('InsertCharPre', {
    pattern: '*',
    sync: true,
  })
  public async completeCharInsert():Promise<void> {
    // TODO save the current char
    let ac = await this.nvim.getVvar('char')
    logger.debug(`inserted:${ac}`)
  }

  @Function('CompleteResume', {sync: false})
  public async completeResume(args: CompleteOptionVim[]):Promise<void> {
    let opt = args[0]
    // TODO disable for now
    if (opt) return
    let start = Date.now()
    logger.debug(`Resume options: ${JSON.stringify(opt)}`)
    let {filetype, col, input, word} = opt
    let complete = completes.getComplete(opt)
    if (complete) {
      logger.debug('Find complete')
    }
    if (!complete || !complete.results || !complete.results.length) return
    // TODO change input to only user input characters
    let items = complete.filterResults(complete.results, input, word, true)
    // logger.debug(`Resume items: ${JSON.stringify(items, null, 2)}`)
    if (!items || items.length === 0) return
    let completeOpt = await this.nvim.getOption('completeopt')
    setConfig({completeOpt})
    this.nvim.setVar('complete#_context', {
      start: col,
      candidates: items
    })
    // TODO find out the way to restore completeopt
    // await this.nvim.setOption('completeopt', 'menuone,noinsert')
    this.nvim.call('complete#_do_complete', []).then(() => {
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
    })
  }

  @Function('CompleteResult', {sync: false})
  public async completeResult(args: any[]):Promise<void> {
    let id = args[0] as string
    let name = args[1] as string
    let items = args[2] as VimCompleteItem[]
    items = items || []
    // logger.debug(`Remote items:${JSON.stringify(items, null, 2)}`)
    remoteStore.setResult(id, name, items)
  }

  @Function('CompleteCheck', {sync: true})
  public async completeCheck():Promise<string[] | null> {
    let {nvim} = this
    await remotes.init(nvim, true)
    let {names} = remotes
    let success = true
    for (let name of names) {
      let source = remotes.createSource(nvim, name, true)
      if (source == null) {
        success = false
        logger.debug(`Result: ${success}`)
      }
    }
    return success ? names: null
  }

  private async onBufferChange(bufnr: string):Promise<void> {
    let lines: string[] = await this.nvim.call('getbufline', [Number(bufnr), 1, '$'])
    let content = (lines as string[]).join('\n')
    if (/\u0000/.test(content)) return
    let keywordOption = await this.nvim.call('getbufvar', [Number(bufnr), '&iskeyword'])
    buffers.addBuffer(bufnr, content, keywordOption)
  }

  private async initConfig(): Promise<void> {
    let {nvim} = this
    let opts: {[index: string]: any} = await nvim.call('complete#get_config', [])
    setConfig(opts)
  }
}
