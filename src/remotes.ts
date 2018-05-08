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

export interface Remote {
  filepath: string
  name: string
  instance: VimSource | null
}

export class Remotes {
  public list: Remote[]

  constructor() {
    this.list = []
  }

  public get names(): string[] {
    return this.list.map(o => o.name)
  }

  public has(name):boolean{
    return this.list.findIndex(o => o.name == name) !== -1
  }

  private getFilepath(name):string|null {
    let remote = this.list.find(o => o.name == name)
    return remote ? remote.filepath : null
  }

  public async init(nvim: Neovim, isCheck?: boolean):Promise<void> {
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
    let {list} = this
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
              let valid = await this.checkSource(nvim, name, fullpath, isCheck)
              if (valid) {
                logger.debug(`Source ${name} verified: ${fullpath}`)
                this.list.push({
                  name,
                  filepath: fullpath,
                  instance: null
                })
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
  }

  private async reportError(nvim: Neovim, name: string, msg: string, fullpath?: string): Promise<void> {
    let path = fullpath || this.getFilepath(name)
    await nvim.call('health#report_error',
      [`${name} source error: ${msg}`,
      path ? [`Check the file ${fullpath}`, 'report error to author!'] : []
    ])
  }

  private async checkSource(nvim: Neovim, name: string, fullpath: string, isCheck?: boolean):Promise<boolean> {
    let fns = ['init', 'complete']
    let valid = true
    for (let fname of fns) {
      let fn = `complete#source#${name}#${fname}`
      let exists = await nvim.call('exists', [`*${fn}`])
      if (exists != 1) {
        valid = false
        let msg =  `Function ${fname} not found for '${name}' source`
        if (isCheck) {
          await this.reportError(nvim, name, msg, fullpath)
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
    let source = new VimSource(nvim, {... config, name})
    return source
  }

  public async getSource(nvim: Neovim, name: string): Promise<VimSource | null> {
    let remote = this.list.find(o => o.name == name)
    if (!remote) {
      logger.error(`Remote source ${name} not found`)
      return null
    }
    if (remote.instance) return remote.instance
    let source =  await this.createSource(nvim, name)
    remote.instance = source
    return source
  }
}

export default new Remotes()
