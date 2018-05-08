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
import pify = require('pify')

export interface Native {
  Clz: typeof Source
  filepath: string
  name: string
  instance: Source | null
}

// controll instances of native sources
export class Natives {
  public list: Native[]

  constructor() {
    this.list = []
  }

  public async init():Promise<void> {
    let root = path.join(__dirname, 'source')
    let files = await pify(fs.readdir)(root, 'utf8')
    for (let file of files) {
      if (/\.js$/.test(file)) {
        let name = file.replace(/\.js$/, '')
        try {
          let Clz = require(`./source/${name}`).default
          this.list.push({
            name,
            Clz,
            filepath: path.join(root, file),
            instance: null
          })
        } catch (e) {
          logger.error(`Native source ${name} error: ${e.message}`)
        }
      }
    }
  }

  public has(name):boolean{
    return this.list.findIndex(o => o.name == name) != -1
  }

  public get names():string[] {
    return this.list.map(o => o.name)
  }

  private async createSource(nvim: Neovim, name: string):Promise<Source | null> {
    let o: Native = this.list.find(o => o.name == name)
    if (!o) return null
    let Clz:any = o.Clz
    return new Clz(nvim)
  }

  public async getSource(nvim: Neovim, name: string): Promise<Source | null> {
    let o: Native = this.list.find(o => o.name == name)
    if (!o) return null
    if (o.instance) return o.instance
    let instance = o.instance  = await this.createSource(nvim, name)
    return instance
  }
}

export default new Natives()
