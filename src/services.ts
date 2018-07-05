import {Neovim} from 'neovim'
import {Disposable} from 'vscode-languageserver-protocol'
import CssService from './extensions/css'
import JsonService from './extensions/json'
import HtmlService from './extensions/html'
import WxmlService from './extensions/wxml'
import TsserverService from './extensions/tsserver'
import {IServiceProvider, ServiceStat} from './types'
import {echoErr, echoMessage, echoWarning} from './util'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  name: string
  state: string
  languageIds: string[]
}

function getStateName(state:ServiceStat):string {
  switch (state) {
    case ServiceStat.Initial:
      return 'init'
    case ServiceStat.Running:
      return 'running'
    case ServiceStat.Starting:
      return 'starting'
    case ServiceStat.StartFailed:
      return 'startFailed'
    case ServiceStat.Stopping:
      return 'stopping'
    case ServiceStat.Stopped:
      return 'stopped'
    default:
      return 'unknown'
  }
}

export class ServiceManager implements Disposable {

  private nvim:Neovim
  private languageIds: Set<string> = new Set()
  private readonly registed: Map<string, IServiceProvider> = new Map()

  public init(nvim:Neovim):void {
    this.nvim = nvim
    this.regist(new TsserverService())
    this.regist(new CssService())
    this.regist(new JsonService())
    this.regist(new HtmlService())
    this.regist(new WxmlService())
  }

  public dispose():void {
    for (let service of this.registed.values()) {
      service.dispose()
    }
  }

  public registServices(services:IServiceProvider[]):void {
    for (let service of services) {
      this.regist(service)
    }
  }

  public regist(service:IServiceProvider): void {
    let {name, languageIds} = service
    if (!service.enable) return
    if (this.registed.get(name)) {
      echoErr(this.nvim, `Service ${name} already exists`).catch(_e => {
        // noop
      })
      return
    }
    this.registed.set(name, service)
    languageIds.forEach(lang => {
      this.languageIds.add(lang)
    })
    service.onServiceReady(async () => {
      await echoMessage(this.nvim, `service ${name} started`)
    })
  }

  private checkProvider(languageId:string, warning = false):boolean {
    if (!languageId) return false
    if (!this.languageIds.has(languageId)) {
      if (warning) {
        echoWarning(this.nvim, `service not found for ${languageId}`) // tslint:disable-line
      }
      return false
    }
    return true
  }

  public getServices(languageId:string):IServiceProvider[] {
    if (!this.checkProvider(languageId)) return
    let res:IServiceProvider[] = []
    for (let service of this.registed.values()) {
      if (service.languageIds.indexOf(languageId) !== -1) {
        res.push(service)
      }
    }
    return res
  }

  public start(languageId:string):void {
    if (!this.checkProvider(languageId)) return
    let services = this.getServices(languageId)
    for (let service of services) {
      let {state} = service
      if (state === ServiceStat.Initial || state === ServiceStat.Stopped) {
        service.init()
      }
    }
  }

  public async stop(name:string):Promise<void> {
    let service = this.registed.get(name)
    if (!service) {
      echoErr(this.nvim, `Service ${name} not found`).catch(_e => {
        // noop
      })
      return
    }
    await Promise.resolve(service.stop())
  }

  public async restart(name:string):Promise<void> {
    let service = this.registed.get(name)
    if (!service) {
      echoErr(this.nvim, `Service ${name} not found`).catch(_e => {}) // tslint:disable-line
      return
    }
    await Promise.resolve(service.restart())
  }

  public getServiceStats():ServiceInfo[] {
    let res:ServiceInfo[] = []
    for (let [name, service] of this.registed) {
      res.push({
        name,
        languageIds: service.languageIds,
        state: getStateName(service.state)
      })
    }
    return res
  }
}

export default new ServiceManager()
