/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Plugin, Autocmd, Function, Neovim } from 'neovim'
import {CompleteOptionVim, VimCompleteItem} from './types'
import {logger} from './util/logger'
import {setConfig, getConfig} from './config'
import debounce = require('debounce')
import buffers from './buffers'
import completes from './completes'
import remoteStore from './remote-store'
import remotes from './remotes'

import fundebug = require('fundebug-nodejs')
fundebug.apikey='08fef3f3304dc6d9acdb5568e4bf65edda6bf3ce41041d40c60404f16f72b86e'

@Plugin({dev: false})
export default class CompletePlugin {
  public nvim: Neovim
  private debouncedOnChange: (bufnr: string)=>void

  constructor(nvim: Neovim) {
    this.nvim = nvim
    this.debouncedOnChange = debounce((bufnr: string) => {
      this.onBufferChange(bufnr)
      logger.debug(`buffer ${bufnr} change`)
    }, 800)

    process.on('unhandledRejection', (reason, p) => {
      logger.error('Unhandled Rejection at:', p, 'reason:', reason)
      if (reason instanceof Error) {
        nvim.call('complete#util#print_errors', [(reason as Error).stack.split(/\n/)]).catch(err => {
          logger.error(err.message)
        })
        if (!getConfig('noTrace') && process.env.NODE_ENV !== 'test') {
          fundebug.notifyError(reason)
        }
      }
    })

    process.on('uncaughtException', err => {
      logger.error(err.stack)
      if (!getConfig('noTrace') && process.env.NODE_ENV !== 'test') {
        fundebug.notifyError(err)
      }
    })
  }

  @Autocmd('VimEnter', {
    sync: false,
    pattern: '*'
  })
  public async onVimEnter(): Promise<void> {
    let {nvim} = this
    await this.initConfig()
    await remotes.init(nvim)
  }

  @Autocmd('BufWritePost', {
    sync: false,
    pattern: '*',
    eval: 'expand("<abuf>")',
  })
  public async onBufferWrite(buf: string): Promise<void> {
    let buftype = await this.nvim.call('getbufvar', [Number(buf), '&buftype'])
    if (!buftype) {
      this.onBufferChange(buf)
    }
  }

  @Function('CompleteBufUnload', {sync: false})
  public async onBufUnload(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    buffers.removeBuffer(bufnr)
    logger.debug(`buffer ${bufnr} remove`)
  }

  @Function('CompleteBufRead', {sync: false})
  public async onBufAdd(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    logger.debug(`buffer ${bufnr} read`)
    this.onBufferChange(bufnr)
  }

  @Function('CompleteBufChange', {sync: false})
  public async onBufChangeI(args: any[]):Promise<void> {
    let bufnr = args[0].toString()
    let curr: number = await this.nvim.call('bufnr', ['%'])
    if (curr.toString() == bufnr) {
      this.debouncedOnChange(bufnr)
    } else {
      logger.debug(`buffer ${bufnr} change`)
      this.onBufferChange(bufnr)
    }
  }

  @Function('CompleteStart', {sync: false})
  public async completeStart(args: CompleteOptionVim[]):Promise<null> {
    let opt = args[0]
    let start = Date.now()
    if (opt) {
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
      return null
    }
  }

  @Function('CompleteResult', {sync: false})
  public async completeResult(args: any[]):Promise<void> {
    let id = args[0] as string
    let name = args[1] as string
    let items = args[2] as VimCompleteItem[]
    remoteStore.setResult(id, name, items)
  }

  private onBufferChange(bufnr: string):void {
    this.nvim.call('getbufline', [Number(bufnr), 1, '$']).then(lines => {
      let content = (lines as string[]).join('\n')
      buffers.addBuffer(bufnr, content)
    }, e => {
      logger.error(e.message)
    })
  }

  private async initConfig(): Promise<void> {
    let {nvim} = this
    let opts: {[index: string]: any} = await nvim.call('complete#get_config', [])
    setConfig(opts)
  }
}
