/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { Neovim } from 'neovim'
import Source from './model/source'
import {SourceOption} from './types'
import {logger} from './util/logger'
import fs = require('fs')
import path = require('path')

// controll instances of native sources
export class Natives {
  public sourceMap: {[index: string] : Source}
  public classMap: {[index: string] : typeof Source}
  public names: string[]

  constructor() {
    this.sourceMap = {}
    this.classMap = {}
    this.names = []
    fs.readdir(path.join(__dirname, 'source'), 'utf8', (err, files) => {
      if (err) return logger.error(`Get not read source ${err.message}`)
      for (let file of files) {
        if (/\.js$/.test(file)) {
          let name = file.replace(/\.js$/, '')
          this.names.push(name)
          this.classMap[name] = require(`./source/${name}`).default
        }
      }
    })
  }

  public has(name):boolean{
    return this.names.indexOf(name) !== -1
  }

  private async createSource(nvim: Neovim, name: string):Promise<Source | null> {
    let Clz: any = this.classMap[name]
    if (!Clz) return null
    return new Clz(nvim)
  }

  public async getSource(nvim: Neovim, name: string): Promise<Source | null> {
    let source = this.sourceMap[name]
    if (source) return source
    source = await this.createSource(nvim, name)
    this.sourceMap[name] = source
    return source
  }
}

export default new Natives()
