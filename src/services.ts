import {Neovim} from 'neovim'
import {
  echoWarning,
  echoMessage,
} from './util/'
import {
  IServiceProvider,
  ServiceStat,
} from './types'
import {
  getConfig
} from './config'
import tsserverService from './typescript-service'
const logger = require('./util/logger')('services')

export class ServiceManager {

  private nvim:Neovim
  private languageIds: Set<string> = new Set()
  private readonly registed: Map<string, IServiceProvider> = new Map()

  public init(nvim:Neovim):void {
    this.nvim = nvim
    let disabledServices = getConfig('disabledServices')
    if (disabledServices.indexOf('tsserver') === -1) {
      this.regist(new tsserverService())
    }
    // TODO regist more services
  }

  public regist(service:IServiceProvider): void {
    let {name, languageIds} = service
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
      if (state === ServiceStat.Init || state === ServiceStat.Stopped) {
        service.init()
      }
    }
  }

  public restart(languageId:string):void {
    if (!this.checkProvider(languageId, true)) return
    let services = this.getServices(languageId)
    for (let service of services.values()) {
      service.restart()
    }
  }
}

export default new ServiceManager()
