import { Neovim } from '@chemzqm/neovim'
import Emitter from 'events'
import fs from 'fs'
import path from 'path'
import { Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import { LanguageService } from './language-client'
import { IServiceProvider, LanguageServerConfig, ServiceStat } from './types'
import { disposeAll, echoErr, echoMessage } from './util'
import workspace from './workspace'
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

export class ServiceManager extends Emitter implements Disposable {
  private nvim: Neovim
  private readonly registed: Map<string, IServiceProvider> = new Map()
  private disposables: Disposable[] = []

  public init(nvim: Neovim): void {
    this.nvim = nvim
    let root = path.join(__dirname, 'extensions')
    let files = fs.readdirSync(root)
    try {
      for (let file of files) {
        let fullpath = path.join(root, file)
        let stat = fs.statSync(fullpath)
        if (stat && stat.isDirectory) {
          try {
            let ServiceClass = require(fullpath).default
            this.regist(new ServiceClass())
          } catch (e) {
            logger.error(`error loading ${file}: ${e.message}`)
          }
        }
      }
      this.createCustomServices()
      let ids = Array.from(this.registed.keys())
      logger.info(`Created services: ${ids.join(',')}`)
    } catch (e) {
      echoErr(this.nvim, `Service init error: ${e.message}`)
      logger.error(e.message)
    }
    workspace.onDidWorkspaceInitialized(() => {
      let document = workspace.getDocument(workspace.bufnr)
      this.start(document.textDocument)
    }, null, this.disposables)

    workspace.onDidOpenTextDocument(doc => {
      this.start(doc)
    }, null, this.disposables)
  }

  public dispose(): void {
    this.removeAllListeners()
    disposeAll(this.disposables)
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
    let { id } = service
    if (!id) logger.error('invalid service ', service.name)
    if (!service.enable) return
    if (this.registed.get(id)) {
      echoErr(this.nvim, `Service ${id} already exists`)
      return
    }
    this.registed.set(id, service)
    service.onServiceReady(() => {
      echoMessage(this.nvim, `service ${id} started`)
      this.emit('ready', id)
    }, null, this.disposables)
  }

  public getService(id: string): IServiceProvider {
    return this.registed.get(id)
  }

  public getServices(document: TextDocument): IServiceProvider[] {
    let res: IServiceProvider[] = []
    for (let service of this.registed.values()) {
      if (workspace.match(service.selector, document) > 0) {
        res.push(service)
      }
    }
    return res
  }

  private start(document: TextDocument): void {
    let services = this.getServices(document)
    for (let service of services) {
      let { state } = service
      if (state === ServiceStat.Initial) {
        logger.debug('starting', service.name)
        service.init().catch(e => {
          logger.error(`service ${service.name} start failed: ${e.message}`)
        })
      }
    }
  }

  public stop(id: string): Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      echoErr(this.nvim, `Service ${id} not found`)
      return
    }
    return Promise.resolve(service.stop())
  }

  public async stopAll(): Promise<void> {
    for (let service of this.registed.values()) {
      await Promise.resolve(service.stop())
    }
  }

  public async toggle(id: string): Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      return echoErr(this.nvim, `Service ${id} not found`)
    }
    let { state } = service
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
        languageIds: documentSelectorToLanguageIds(service.selector),
        state: getStateName(service.state)
      })
    }
    return res
  }

  private createCustomServices(): void {
    let base = 'languageserver'
    let lspConfig = workspace.getConfiguration().get<{ string: LanguageServerConfig }>(base)
    for (let key of Object.keys(lspConfig)) {
      let config = lspConfig[key]
      let id = `${base}.${key}`
      this.regist(
        new LanguageService(id, key, config)
      )
    }
  }
}

function documentSelectorToLanguageIds(documentSelector: DocumentSelector): string[] {
  let res = documentSelector.map(filter => {
    if (typeof filter == 'string') {
      return filter
    }
    return filter.language
  })
  res = res.filter(s => s != null)
  if (res.length == 0) {
    throw new Error('Invliad document selector')
  }
  return res
}

export default new ServiceManager()
