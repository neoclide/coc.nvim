import fs from 'fs'
import {Neovim} from 'neovim'
import path from 'path'
import pify from 'pify'
import languageClient from './language-client'
import workspace from './workspace'
import {Disposable} from 'vscode-languageserver-protocol'
import {IServiceProvider, ServiceStat} from './types'
import {echoErr, echoMessage, echoWarning} from './util'
import {statAsync} from './util/fs'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  id: string
  state: string
  languageIds: string[]
}

function getStateName(state: ServiceStat): string {
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
  private nvim: Neovim
  private languageIds: Set<string> = new Set()
  private readonly registed: Map<string, IServiceProvider> = new Map()

  public async init(nvim: Neovim): Promise<void> {
    this.nvim = nvim
    let root = path.join(__dirname, 'extensions')
    try {
      let files = await pify(fs.readdir)(root, 'utf8')
      // TODO
      for (let file of files) {
        let fullpath = path.join(root, file)
        let stat = await statAsync(fullpath)
        if (stat && stat.isDirectory) {
          try {
            let ServiceClass = require(fullpath).default
            this.regist(new ServiceClass())
          } catch (e) {
            logger.error(`error loading ${file}: ${e.message}`)
          }
        }
      }
      languageClient.init()
      for (let service of languageClient.services) {
        this.regist(service)
      }
      let ids = Array.from(this.registed.keys())
      logger.info(`Created services: ${ids.join(',')}`)
      let {filetypes} = workspace
      for (let filetype of filetypes) {
        this.start(filetype)
      }
    } catch (e) {
      echoErr(this.nvim, `Service init error: ${e.message}`)
      logger.error(e.message)
    }
  }

  public dispose(): void {
    for (let service of this.registed.values()) {
      service.dispose()
    }
  }

  public registServices(services: IServiceProvider[]): void {
    for (let service of services) {
      this.regist(service)
    }
  }

  public regist(service: IServiceProvider): void {
    let {id, languageIds} = service
    if (!id) logger.error('invalid service ', service.name)
    if (!service.enable) return
    if (this.registed.get(id)) {
      echoErr(this.nvim, `Service ${id} already exists`)
      return
    }
    this.registed.set(id, service)
    languageIds.forEach(lang => {
      this.languageIds.add(lang)
    })
    service.onServiceReady(() => {
       echoMessage(this.nvim, `service ${id} started`)
    })
  }

  private checkProvider(languageId: string, warning = false): boolean {
    if (!languageId) return false
    if (!this.languageIds.has(languageId)) {
      if (warning) {
        echoWarning(this.nvim, `service not found for ${languageId}`)
      }
      return false
    }
    return true
  }

  public getService(id: string): IServiceProvider {
    return this.registed.get(id)
  }

  public getServices(languageId: string): IServiceProvider[] {
    if (!this.checkProvider(languageId)) return
    let res: IServiceProvider[] = []
    for (let service of this.registed.values()) {
      if (service.languageIds.indexOf(languageId) !== -1) {
        res.push(service)
      }
    }
    return res
  }

  public start(languageId: string): void {
    if (!this.checkProvider(languageId)) return
    logger.debug('starting', languageId)
    let services = this.getServices(languageId)
    for (let service of services) {
      let {state} = service
      if (state === ServiceStat.Initial) {
        service.init().catch(e => {
          logger.error(`service ${service.name} start failed: ${e.message}`)
        })
      }
    }
  }

  public async stop(id: string): Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      echoErr(this.nvim, `Service ${id} not found`)
      return
    }
    await Promise.resolve(service.stop())
  }

  public async toggle(id: string): Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      return echoErr(this.nvim, `Service ${id} not found`)
    }
    let {state} = service
    try {
      if (state == ServiceStat.Running) {
        await Promise.resolve(service.stop())
      } else if (state == ServiceStat.Initial) {
        await service.init()
      } else if (state == ServiceStat.Stopped) {
        await service.restart()
      }
    } catch (e) {
      echoErr(this.nvim, `Service error: ${e.message}`)
    }
  }

  public getServiceStats(): ServiceInfo[] {
    let res: ServiceInfo[] = []
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
