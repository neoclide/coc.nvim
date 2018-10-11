import { EventEmitter } from 'events'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { Disposable, DocumentSelector, Emitter, TextDocument } from 'vscode-languageserver-protocol'
import which from 'which'
import { ForkOptions, LanguageClient, LanguageClientOptions, ServerOptions, SpawnOptions, State, Transport, TransportKind, RevealOutputChannelOn } from './language-client'
import { IServiceProvider, LanguageServerConfig, ServiceStat } from './types'
import { disposeAll } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  id: string
  state: string
  languageIds: string[]
}

interface LazyClient {
  id: string
  documentSelector: DocumentSelector
  init: Function
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

export class ServiceManager extends EventEmitter implements Disposable {
  private readonly registed: Map<string, IServiceProvider> = new Map()
  private readonly lazyClients: Set<LazyClient> = new Set()
  private disposables: Disposable[] = []

  public init(): void {
    this.createCustomServices()
    workspace.onDidOpenTextDocument(document => {
      this.checkLazyClients(document)
      this.start(document)
    }, null, this.disposables)
    // this.checkLazyClients()
  }

  public dispose(): void {
    this.removeAllListeners()
    disposeAll(this.disposables)
    for (let service of this.registed.values()) {
      service.dispose()
    }
  }

  public regist(service: IServiceProvider): Disposable {
    let { id } = service
    if (!id) logger.error('invalid service ', service.name)
    if (service.enable === false) return
    if (this.registed.get(id)) {
      workspace.showMessage(`Service ${id} already exists`, 'error')
      return
    }
    this.registed.set(id, service)
    if (this.shouldStart(service)) {
      service.start() // tslint:disable-line
    }
    service.onServiceReady(() => {
      workspace.showMessage(`service ${id} started`, 'more')
      this.emit('ready', id)
    }, null, this.disposables)
    return Disposable.create(() => {
      service.stop()
      service.dispose()
      this.registed.delete(id)
    })
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

  private shouldStart(service: IServiceProvider): boolean {
    if (service.state != ServiceStat.Initial) {
      return false
    }
    return this.matchSelector(service.selector)
  }

  private matchSelector(selector: DocumentSelector): boolean {
    for (let doc of workspace.documents) {
      if (workspace.match(selector, doc.textDocument)) {
        return true
      }
    }
    return false
  }

  private start(document: TextDocument): void {
    let services = this.getServices(document)
    for (let service of services) {
      if (service.state == ServiceStat.Initial) {
        service.start() // tslint:disable-line
      }
    }
  }

  public stop(id: string): Promise<void> {
    let service = this.registed.get(id)
    if (!service) {
      workspace.showMessage(`Service ${id} not found`, 'error')
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
      workspace.showMessage(`Service ${id} not found`, 'error')
      return
    }
    let { state } = service
    try {
      if (state == ServiceStat.Running) {
        await Promise.resolve(service.stop())
      } else if (state == ServiceStat.Initial) {
        await service.start()
      } else if (state == ServiceStat.Stopped) {
        await service.restart()
      }
    } catch (e) {
      workspace.showMessage(`Service error: ${e.message}`, 'error')
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
      if (config.enable === false) continue
      let opts = getLanguageServerOptions(id, key, config)
      if (!opts) continue
      this.lazyClients.add({
        id,
        documentSelector: opts[0].documentSelector || [{ language: '*' }],
        init: () => {
          let client = new LanguageClient(id, key, opts[1], opts[0])
          this.registLanguageClient(client)
        }
      })
    }
  }

  private checkLazyClients(document?: TextDocument): void {
    for (let [client] of this.lazyClients.entries()) {
      if ((document && workspace.match(client.documentSelector, document))
        || this.matchSelector(client.documentSelector)) {
        this.lazyClients.delete(client)
        client.init()
      }
    }
  }

  public async sendRequest(id: string, method: string, params?: any): Promise<any> {
    let service = this.getService(id)
    if (!service) service = this.getService(`languageserver.${id}`)
    if (!service || !service.client) {
      workspace.showMessage(`LanguageClient ${id} not found`)
      return
    }
    if (params) {
      return await service.client.sendRequest(method, params)
    }
    return await service.client.sendRequest(method)
  }

  public registLanguageClient(client: LanguageClient): Disposable {
    let disposables: Disposable[] = []
    let onDidServiceReady = new Emitter<void>()

    let service: IServiceProvider = {
      client,
      enable: true,
      id: client.id,
      name: client.name,
      selector: client.clientOptions.documentSelector,
      state: ServiceStat.Initial,
      onServiceReady: onDidServiceReady.event,
      start: (): Promise<void> => {
        if (service.state != ServiceStat.Initial && service.state != ServiceStat.Stopped) {
          return Promise.resolve()
        }
        service.state = ServiceStat.Starting
        logger.debug(`starting service: ${client.name}`)
        let disposable = client.start()
        disposables.push(disposable)
        return new Promise(resolve => {
          client.onReady().then(() => {
            onDidServiceReady.fire(void 0)
            resolve()
          }, e => {
            workspace.showMessage(`Server ${client.name} failed to start: ${e ? e.message : ''}`)
            service.state = ServiceStat.StartFailed
            resolve()
          })
        })
      },
      dispose: () => {
        client.stop()
        onDidServiceReady.dispose()
        disposeAll(disposables)
      },
      stop: async (): Promise<void> => {
        return await Promise.resolve(client.stop())
      },
      restart: async (): Promise<void> => {
        if (service.state == ServiceStat.Running) {
          await service.stop()
        }
        service.state = ServiceStat.Starting
        client.restart()
      },
    }
    client.onDidChangeState(changeEvent => {
      let { oldState, newState } = changeEvent
      if (newState == State.Starting) {
        service.state = ServiceStat.Starting
      } else if (newState == State.Running) {
        service.state = ServiceStat.Running
      } else if (newState == State.Stopped) {
        service.state = ServiceStat.Stopped
      }
      let oldStr = stateString(oldState)
      let newStr = stateString(newState)
      logger.info(`${client.name} state change: ${oldStr} => ${newStr}`)
    }, null, disposables)

    return this.regist(service)
  }
}

function documentSelectorToLanguageIds(documentSelector: DocumentSelector): string[] {
  let res = documentSelector.map(filter => {
    if (typeof filter == 'string') {
      return filter
    }
    return filter.language
  })
  res = res.filter(s => typeof s == 'string')
  return res
}

// convert config to options
function getLanguageServerOptions(id: string, name: string, config: LanguageServerConfig): [LanguageClientOptions, ServerOptions] {
  let { command, module, port, args } = config
  args = args || []
  if (!command && !module && !port) {
    workspace.showMessage(`Invalid config of language server ${name}`, 'error')
    return null
  }
  if (module && !fs.existsSync(module as string)) {
    workspace.showMessage(`module file ${module} not found for ${name}`, 'error')
    return null
  }
  if (command) {
    try {
      let resolved = which.sync(config.command)
      if (args.indexOf('--node-ipc') !== -1) {
        module = resolved
      }
    } catch (e) {
      workspace.showMessage(`Executable ${command} not found`, 'error')
      return null
    }
  }
  let isModule = module != null
  let serverOptions: ServerOptions
  if (isModule) {
    serverOptions = {
      module: module.toString(),
      args,
      transport: getTransportKind(args),
      options: getSpawnOptions(config)
    }
  } else if (command) {
    serverOptions = {
      command,
      args,
      options: getForkOptions(config)
    }
  } else if (port) {
    serverOptions = () => {
      return new Promise((resolve, reject) => {
        let client = new net.Socket()
        client.connect(port, config.host || '127.0.0.1', () => {
          resolve({
            reader: client,
            writer: client
          })
        })
        client.on('error', e => {
          reject(new Error(`Connection error for ${id}: ${e.message}`))
        })
      })
    }
  }
  let section = config.settings == null ? null : `${id}.settings`
  let clientOptions: LanguageClientOptions = {
    documentSelector: config.filetypes || [{ language: '*' }],
    revealOutputChannelOn: getRevealOutputChannelOn(config.revealOutputChannelOn),
    synchronize: {
      configurationSection: section
    },
    diagnosticCollectionName: name,
    outputChannelName: id,
    stdioEncoding: config.stdioEncoding || 'utf8',
    initializationOptions: config.initializationOptions || {}
  }
  return [clientOptions, serverOptions]
}

function getRevealOutputChannelOn(revealOn: string | undefined): RevealOutputChannelOn {
  switch (revealOn) {
    case 'info':
      return RevealOutputChannelOn.Info
    case 'warn':
      return RevealOutputChannelOn.Warn
    case 'error':
      return RevealOutputChannelOn.Error
    case 'never':
      return RevealOutputChannelOn.Never
    default:
      return RevealOutputChannelOn.Error
  }
}

function getTransportKind(args: string[]): Transport {
  if (!args || args.indexOf('--node-ipc') !== -1) {
    return TransportKind.ipc
  }
  if (args.indexOf('--stdio') !== -1) {
    return TransportKind.stdio
  }
  let idx = args.findIndex(s => s === '--socket' || s === '--port')
  if (idx !== -1 && typeof args[idx + 1] == 'number') {
    let n = args[idx + 1]
    return {
      kind: TransportKind.socket,
      port: Number(n)
    }
  }
  return TransportKind.ipc
}

function getForkOptions(config: LanguageServerConfig): ForkOptions {
  return {
    cwd: getCwd(config.cwd),
    execArgv: config.execArgv || []
  }
}

function getSpawnOptions(config: LanguageServerConfig): SpawnOptions {
  return {
    cwd: getCwd(config.cwd),
    detached: !!config.detached,
    shell: !!config.shell
  }
}

function getCwd(cwd: string): string {
  if (cwd) {
    if (path.isAbsolute(cwd)) return cwd
    let p = path.join(workspace.root, cwd)
    if (fs.existsSync(p)) return p
  }
  return workspace.root
}

function stateString(state: State): string {
  switch (state) {
    case State.Running:
      return 'running'
    case State.Starting:
      return 'starting'
    case State.Stopped:
      return 'stopped'
  }
  return 'unknown'
}

export default new ServiceManager()
