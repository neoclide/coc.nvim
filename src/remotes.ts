/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim'
import VimSource from './model/source-vim'
import {SourceOption} from './types'
import {logger} from './util/logger'
import {echoWarning} from './util/index'
import path = require('path')
import pify = require('pify')
import fs = require('fs')

export class Remotes {
  public sourceMap: {[index: string] : VimSource}
  public initailized: boolean
  private pathMap: {[index: string] : string}

  constructor() {
    this.sourceMap = {}
    this.pathMap = {}
    this.initailized = false
  }

  private get names(): string[] {
    return Object.keys(this.pathMap)
  }

  public has(name):boolean{
    if (!this.initailized) return false
    return this.names.indexOf(name) !== -1
  }

  public async init(nvim: Neovim):Promise<void> {
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
    let {pathMap} = this
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
              let name = path.basename(f, '.vim')
              if (this.names.indexOf(name) !== -1) {
                echoWarning(nvim, `source ${name} found in multiple runtimes, run ':checkhealth' for detail`)
              } else {
                pathMap[name] = fullpath
                await nvim.command(`source ${fullpath}`)
                await this.createSource(nvim, name)
                logger.debug(`Source ${name} created: ${fullpath}`)
              }
            }
          }
        }
      } catch (e) {} // tslint:disable-line
    }
    this.initailized = true
  }

  public async checkFunctions(nvim: Neovim):Promise<string[]> {
    let res = []
    let {pathMap} = this
    for (let name of this.names) {
      let fn = `complete#source#${name}#init`
      let exists = await nvim.call('exists', [`*${fn}`])
      if (exists != 1) {
        res.push(`Error: ${fn} not found`)
      }
    }
    return res
  }

  private async createSource(nvim: Neovim, name: string):Promise<VimSource | null> {
    let fn = `complete#source#${name}#init`
    let exists = await nvim.call('exists', [`*${fn}`])
    if (exists != 1) {
      logger.error(`Init function not found of ${name}`)
      return null
    }
    let config: SourceOption = await nvim.call(fn, [])
    config.engross = !!config.engross
    if (!Number.isInteger(config.priority)) {
      let priority = parseInt(config.priority as any, 10)
      config.priority = isNaN(priority) ? 0 : priority
    }
    let source = new VimSource(nvim, config)
    this.sourceMap[name] = source
    return source
  }

  public async getSource(nvim: Neovim, name: string): Promise<VimSource | null> {
    let source = this.sourceMap[name]
    if (source) return source
    // make vim source the file first time loaded, so we can check function
    let {pathMap} = this
    source =  await this.createSource(nvim, name)
    return source
  }
}

export default new Remotes()
