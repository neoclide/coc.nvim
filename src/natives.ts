import { Neovim } from 'neovim'
import Source from './model/source'
import ServiceSource from './model/source-service'
import { echoErr } from './util/index'
import fs = require('fs')
import path = require('path')
import pify = require('pify')
import {serviceMap} from './source/service'
import {getConfig} from './config'
const logger = require('./util/logger')('natives')

export interface Native {
  Clz: typeof Source
  filepath: string
  name: string
  instance: Source| ServiceSource | null
  service: boolean
}

// controll instances of native sources
export class Natives {
  public list: Native[] = []
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
            service: false,
            instance: null
          })
        } catch (e) {
          logger.error(`Native source ${name} error: ${e.message}`)
        }
      }
    }
    // TODO remove service
    for (let key of Object.keys(serviceMap)) {
      let arr = serviceMap[key]
      for (let name of arr) {
        this.list.push({
          name,
          Clz: require(`./source/service/${name}`).default,
          filepath: path.join(root, `./service/${name}.js`),
          service: true,
          instance: null
        })
      }
    }
  }

  public has(name):boolean{
    return this.list.findIndex(o => o.name == name) != -1
  }

  public getSourceNamesOfFiletype(filetype:string):string[] {
    let list = this.list.filter(o => !o.service)
    let names = list.map(o => o.name)
    let services = serviceMap[filetype]
    if (services) names = names.concat(services)
    return names
  }

  public get names():string[] {
    return this.list.map(o => o.name)
  }

  private async createSource(nvim: Neovim, name: string):Promise<Source | null> {
    let o: Native = (this.list as any).find(o => o.name == name)
    if (!o) return null
    let Clz:any = o.Clz
    let instance = new Clz(nvim)
    if (typeof instance.onInit == 'function') {
      await instance.onInit()
    }
    return instance
  }

  public async getServiceSource(nvim:Neovim, filetype:string):Promise<ServiceSource|null> {
    let names = serviceMap[filetype]
    if (!names) return null
    let disabled = getConfig('disabled')
    names = names.filter(name => disabled.indexOf(name) === -1)
    if (!names.length) return null
    let source = await this.getSource(nvim, names[0])
    return source as ServiceSource
  }

  public async getSource(nvim: Neovim, name: string): Promise<Source | null> {
    let o: Native = (this.list as any).find(o => o.name == name)
    if (!o) return null
    if (o.instance) return o.instance
    let instance
    try {
      instance = o.instance  = await this.createSource(nvim, name)
    } catch (e) {
      let msg = `Create source ${name} error: ${e.message}`
      await echoErr(nvim, msg)
      logger.error(e.stack)
      return null
    }
    return instance
  }
}

export default new Natives()
