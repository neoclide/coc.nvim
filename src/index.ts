/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Plugin, Autocmd, Function, Neovim } from 'neovim'
import {CompleteOptionVim} from './types'
import {logger} from './util/logger'
import {setConfig} from './config'
import debounce = require('debounce')
import pify = require('pify')
import fs = require('fs')
import path = require('path')
import buffers from './buffers'
import completes from './completes'

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
  }

  @Autocmd('VimEnter', {
    sync: false,
    pattern: '*'
  })
  public async onVimEnter(): Promise<void> {
    let {nvim} = this
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
    let vimfiles: string[] = []
    for (let p of paths) {
      let folder = path.join(p, 'autoload/complete/source')
      try {
        let stat = await pify(fs.stat)(folder)
        if (stat.isDirectory()) {
          let files = await pify(fs.readdir)(folder)
          for (let f of files) {
            let fullpath = path.join(folder, f)
            let s = await pify(fs.stat)(fullpath)
            if (s.isFile()) {
              vimfiles.push(fullpath)
            }
          }
        }
      } catch (e) {} // tslint:disable-line
    }
    await this.initConfig()
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
    this.debouncedOnChange(bufnr)
  }

  @Function('CompleteStart', {sync: true})
  public async completeStart(args: CompleteOptionVim[]):Promise<void> {
    let opt = args[0]
    let start = Date.now()
    if (opt) {
      logger.debug(`options: ${JSON.stringify(opt)}`)
      let {filetype, col} = opt
      let complete = completes.createComplete(opt)
      let sources = completes.getSources(this.nvim, filetype)
      let items = await complete.doComplete(sources)
      if (items === null) items = []
      logger.debug(`items: ${JSON.stringify(items, null, 2)}`)
      if (items.length > 0) {
        this.nvim.setVar('complete#_context', {
          start: col,
          candidates: items
        })
        await this.nvim.call('complete#_do_complete', [])
      }
      logger.debug(`Complete time cost: ${Date.now() - start}ms`)
    }
  }

  private onBufferChange(bufnr: string):void {
    this.nvim.call('getbufline', [Number(bufnr), 1, '$']).then(lines => {
      let content = (lines as string[]).join('\n')
      buffers.addBuffer(bufnr, content)
    }, e => {
      logger.debug(e.message)
    })
  }

  private async initConfig(): Promise<void> {
    let {nvim} = this
    let opts: {[index: string]: any} = await nvim.call('complete#get_config', [])
    logger.debug(`config:${JSON.stringify(opts)}`)
    setConfig(opts)
  }
}

process.on('unhandledRejection', (reason, p) => {
  logger.error('Unhandled Rejection at:', p, 'reason:', reason)
})
