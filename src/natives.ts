import { Neovim } from 'neovim'
import Source from './model/source'
import {SourceOption} from './types'
import {echoErr} from './util/index'
import fs = require('fs')
import path = require('path')
import pify = require('pify')
const logger = require('./util/logger')('natives')

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

  public get sources():Source[] {
    let arr = this.list.map(o => o.instance)
    return arr.filter(o => o != null)
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
    let instance = new Clz(nvim)
    if (typeof instance.onInit == 'function') {
      await instance.onInit()
    }
    return instance
  }

  public async getSource(nvim: Neovim, name: string): Promise<Source | null> {
    let o: Native = this.list.find(o => o.name == name)
    if (!o) return null
    if (o.instance) return o.instance
    let instance
    try {
      instance = o.instance  = await this.createSource(nvim, name)
    } catch (e) {
      let msg = `Create source ${name} error: ${e.message}`
      // await echoErr(nvim, msg)
      logger.error(e.stack)
      return null
    }
    return instance
  }
}

export default new Natives()
