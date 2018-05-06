/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim'
import VimSource from './model/source-vim'
import {SourceOption} from './types'
import {logger} from './util/logger'
import {echoWarning, echoErr} from './util/index'
import {statAsync} from './util/fs'
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

  public get names(): string[] {
    return Object.keys(this.pathMap)
  }

  public has(name):boolean{
    if (!this.initailized) return false
    return this.names.indexOf(name) !== -1
  }

  public async init(nvim: Neovim, isCheck?: boolean):Promise<void> {
    if (this.initailized) return
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
    let {pathMap} = this
    let dups: {[index: string]: string[]} = {}
    for (let p of paths) {
      let folder = path.join(p, 'autoload/complete/source')
      let stat = await statAsync(folder)
      if (stat && stat.isDirectory()) {
        let files = await pify(fs.readdir)(folder)
        for (let f of files) {
          if (!/\.vim$/.test(f)) continue
          let fullpath = path.join(folder, f)
          let s = await statAsync(fullpath)
          if (s && s.isFile()) {
            let name = path.basename(f, '.vim')
            if (this.names.indexOf(name) !== -1) {
              if (isCheck) {
                let paths = dups[name] || []
                paths.push(fullpath)
                dups[name] = paths
              } else {
                echoWarning(nvim, `source ${name} found in multiple runtimes, run ':checkhealth' for detail`)
              }
            } else {
              try {
                await nvim.command(`source ${fullpath}`)
              } catch (e) {
                if (isCheck) {
                  await this.reportError(nvim, name, `vim script error ${e.message}` , fullpath)
                } else {
                  echoErr(nvim, `Vim error from ${name} source: ${e.message}`)
                }
                continue
              }
              let valid = await this.checkSource(nvim, name, isCheck)
              if (valid) {
                pathMap[name] = fullpath
                logger.debug(`Source ${name} verified: ${fullpath}`)
              }
            }
          }
        }
      }
      if (isCheck) {
        for (let name of Object.keys(dups)) {
          let paths = dups[name]
          await nvim.call('health#report_warn', [
            `Same source ${name} found in multiple runtimes`,
            ['Consider remove the duplicates: '].concat(paths)
          ])
        }
        await nvim.call('health#report_info', [`Activted vim sources: ${this.names.join(',')}`])
      }
    }
    this.initailized = true
  }

  private async reportError(nvim: Neovim, name: string, msg: string, fullpath?: string): Promise<void> {
    let path = fullpath || this.pathMap[name]
    await nvim.call('health#report_error',
      [`${name} source error: ${msg}`,
      [`Check the file ${fullpath}`, 'report error to author!']
    ])
  }

  private async checkSource(nvim: Neovim, name: string, isCheck?: boolean):Promise<boolean> {
    let fns = ['init', 'complete']
    let valid = true
    for (let fname of fns) {
      let fn = `complete#source#${name}#${fname}`
      let exists = await nvim.call('exists', [`*${fn}`])
      if (exists != 1) {
        valid = false
        let msg =  `Function ${fname} not found for '${name}' source`
        if (isCheck) {
          await this.reportError(nvim, name, msg)
        } else {
          await echoErr(nvim, msg)
        }
      }
    }
    return valid
  }

  public async createSource(nvim: Neovim, name: string, isCheck?: boolean):Promise<VimSource | null> {
    let fn = `complete#source#${name}#init`
    let config: SourceOption | null
    try {
      config = await nvim.call(fn, [])
    } catch (e) {
      if (isCheck) {
        await this.reportError(nvim, name, `vim script error on init ${e.message}`)
      } else {
        echoErr(nvim, `Vim error on init from source ${name}: ${e.message}`)
      }
      return null
    }
    let {filetypes, shortcut} = config
    config.name = name
    config.engross = !!config.engross
    if (!Array.isArray(filetypes)) {
      config.filetypes = null
    }
    if (!shortcut) {
      config.shortcut = name.slice(0, 3).toUpperCase()
    } else {
      config.shortcut = shortcut.slice(0, 3).toUpperCase()
    }
    let source = new VimSource(nvim, config)
    this.sourceMap[name] = source
    return source
  }

  public async getSource(nvim: Neovim, name: string): Promise<VimSource | null> {
    let source = this.sourceMap[name]
    if (source) return source
    let {pathMap} = this
    source =  await this.createSource(nvim, name)
    return source
  }
}

export default new Remotes()
