import {Neovim} from 'neovim'
import {Disposable} from 'vscode-languageserver-protocol'
import CssService from './extensions/css'
import JsonService from './extensions/json'
import HtmlService from './extensions/html'
import WxmlService from './extensions/wxml'
import TsserverService from './extensions/tsserver'
import TslintService from './extensions/tslint'
import {IServiceProvider, ServiceStat} from './types'
import {echoErr, echoMessage, echoWarning} from './util'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  id: string
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
    this.regist(new TslintService())
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
    let {id, languageIds} = service
    if (!service.enable) return
    if (this.registed.get(id)) {
      echoErr(this.nvim, `Service ${id} already exists`).catch(_e => {
        // noop
      })
      return
    }
    this.registed.set(id, service)
    languageIds.forEach(lang => {
      this.languageIds.add(lang)
    })
    service.onServiceReady(async () => {
      await echoMessage(this.nvim, `service ${id} started`)
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

  public async stop(id:string):Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      echoErr(this.nvim, `Service ${id} not found`).catch(_e => {
        // noop
      })
      return
    }
    await Promise.resolve(service.stop())
  }

  public async toggle(id:string):Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      return echoErr(this.nvim, `Service ${id} not found`)
    }
    let {state} = service
    if (state == ServiceStat.Running) {
      await Promise.resolve(service.stop())
    } else if (state == ServiceStat.Initial) {
      await service.init()
    } else if (state == ServiceStat.Stopped) {
      await service.restart()
    }
  }

  public getServiceStats():ServiceInfo[] {
    let res:ServiceInfo[] = []
    for (let [id, service] of this.registed) {
      res.push({
        id,
        languageIds: service.languageIds,
        state: getStateName(service.state)
      })
    }
    return res
  }
}

export default new ServiceManager()
