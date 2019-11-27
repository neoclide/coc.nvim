import { EventEmitter } from 'events'
import fs from 'fs'
import net from 'net'
import os from 'os'
import { Disposable, DocumentSelector, Emitter, TextDocument } from 'vscode-languageserver-protocol'
import { Executable, ForkOptions, LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions, SpawnOptions, State, Transport, TransportKind } from './language-client'
import { IServiceProvider, LanguageServerConfig, ServiceStat } from './types'
import { disposeAll, wait } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  id: string
  state: string
  languageIds: string[]
}

export function getStateName(state: ServiceStat): string {
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
  private readonly registered: Map<string, IServiceProvider> = new Map()
  private disposables: Disposable[] = []

  public init(): void {
    workspace.onDidOpenTextDocument(document => {
      this.start(document)
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('languageserver')) {
        this.createCustomServices()
      }
    }, null, this.disposables)
    this.createCustomServices()
  }

  public dispose(): void {
    this.removeAllListeners()
    disposeAll(this.disposables)
    for (let service of this.registered.values()) {
      service.dispose()
    }
  }

  public regist(service: IServiceProvider): Disposable {
    let { id } = service
    if (!id) logger.error('invalid service configuration. ', service.name)
    if (this.registered.get(id)) return
    this.registered.set(id, service)
    logger.info(`registered service "${id}"`)
    if (this.shouldStart(service)) {
      service.start() // tslint:disable-line
    }
    if (service.state == ServiceStat.Running) {
      this.emit('ready', id)
    }
    service.onServiceReady(() => {
      logger.info(`service ${id} started`)
      this.emit('ready', id)
    }, null, this.disposables)
    return Disposable.create(() => {
      service.stop()
      service.dispose()
      this.registered.delete(id)
    })
  }

  public getService(id: string): IServiceProvider {
    let service = this.registered.get(id)
    if (!service) service = this.registered.get(`languageserver.${id}`)
    return service
  }

  private hasService(id: string): boolean {
    return this.registered.has(id)
  }

  private shouldStart(service: IServiceProvider): boolean {
    if (service.state != ServiceStat.Initial) {
      return false
    }
    let selector = service.selector
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

  public getServices(document: TextDocument): IServiceProvider[] {
    let res: IServiceProvider[] = []
    for (let service of this.registered.values()) {
      if (workspace.match(service.selector, document) > 0) {
        res.push(service)
      }
    }
    return res
  }

  public stop(id: string): Promise<void> {
    let service = this.registered.get(id)
    if (!service) {
      workspace.showMessage(`Service ${id} not found`, 'error')
      return
    }
    return Promise.resolve(service.stop())
  }

  public async stopAll(): Promise<void> {
    for (let service of this.registered.values()) {
      await Promise.resolve(service.stop())
    }
  }

  public async toggle(id: string): Promise<void> {
    let service = this.registered.get(id)
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
    for (let [id, service] of this.registered) {
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
    let lspConfig = workspace.getConfiguration().get<{ string: LanguageServerConfig }>(base, {} as any)
    for (let key of Object.keys(lspConfig)) {
      if (this.registered.get(key)) continue
      let config: LanguageServerConfig = lspConfig[key]
      let id = `${base}.${key}`
      if (config.enable === false || this.hasService(id)) continue
      let lazy_opts = () => {
        // re-read configuration
        let lspConfig_ = workspace.getConfiguration().get<{ string: LanguageServerConfig }>(base, {} as any)
        return getLanguageServerOptions(id, key, lspConfig_[key])
      }
      if (!lazy_opts()) continue
      let client = new LanguageClient(id, key, { deferredOptions: lazy_opts })
      this.registLanguageClient(client)
    }
  }

  private waitClient(id: string): Promise<void> {
    let service = this.getService(id)
    if (service && service.state == ServiceStat.Running) return Promise.resolve()
    if (service) return new Promise(resolve => {
      service.onServiceReady(() => {
        resolve()
      })
    })
    return new Promise(resolve => {
      let listener = clientId => {
        if (clientId == id || clientId == `languageserver.${id}`) {
          this.off('ready', listener)
          resolve()
        }
      }
      this.on('ready', listener)
    })
  }

  public async registNotification(id: string, method: string): Promise<void> {
    await this.waitClient(id)
    let service = this.getService(id)
    if (!service.client) {
      workspace.showMessage(`Not a language client: ${id}`, 'error')
      return
    }
    let client = service.client as LanguageClient
    client.onNotification(method, async result => {
      await workspace.nvim.call('coc#do_notify', [id, method, result])
    })
  }

  public async sendRequest(id: string, method: string, params?: any): Promise<any> {
    if (!method) {
      throw new Error(`method required for sendRequest`)
    }
    let service = this.getService(id)
    // wait for extension activate
    if (!service) await wait(100)
    service = this.getService(id)
    if (!service || !service.client) {
      throw new Error(`Language server ${id} not found`)
    }
    if (service.state == ServiceStat.Starting) {
      await service.client.onReady()
    }
    if (service.state != ServiceStat.Running) {
      throw new Error(`Language server ${id} not running`)
    }
    return await Promise.resolve(service.client.sendRequest(method, params))
  }

  public registLanguageClient(client: LanguageClient): Disposable {
    let disposables: Disposable[] = []
    let onDidServiceReady = new Emitter<void>()

    let service: IServiceProvider = {
      client,
      id: client.id,
      name: client.name,
      selector: client.clientOptions.documentSelector,
      state: ServiceStat.Initial,
      onServiceReady: onDidServiceReady.event,
      start: (): Promise<void> => {
        if (service.state != ServiceStat.Initial && service.state != ServiceStat.Stopped) {
          return Promise.resolve()
        }
        if (client.getPublicState() == State.Starting) {
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
            workspace.showMessage(`Server ${client.name} failed to start: ${e ? e.message : ''}`, 'error')
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

export function documentSelectorToLanguageIds(documentSelector: DocumentSelector): string[] {
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
export function getLanguageServerOptions(id: string, name: string, config: LanguageServerConfig): [LanguageClientOptions, ServerOptions] {
  let { command, module, port, args, filetypes } = config
  args = args || []
  if (!filetypes) {
    workspace.showMessage(`Wrong configuration of LS "${name}", filetypes not found`, 'error')
    return null
  }
  if (!command && !module && !port) {
    workspace.showMessage(`Wrong configuration of LS "${name}", no command or module specified.`, 'error')
    return null
  }
  if (module && !fs.existsSync(module as string)) {
    workspace.showMessage(`Module file "${module}" not found for LS "${name}"`, 'error')
    return null
  }
  if (filetypes.length == 0) return
  let isModule = module != null
  let serverOptions: ServerOptions
  if (isModule) {
    serverOptions = {
      module: module.toString(),
      runtime: config.runtime || process.execPath,
      args,
      transport: getTransportKind(config),
      options: getForkOptions(config)
    }
  } else if (command) {
    serverOptions = {
      command,
      args,
      options: getSpawnOptions(config)
    } as Executable
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
  let documentSelector: DocumentSelector = []
  config.filetypes.forEach(filetype => {
    let schemes = ['file', 'untitled'].concat(config.additionalSchemes || [])
    documentSelector.push(...schemes.map(scheme => {
      return { language: filetype, scheme }
    }))
  })
  if (documentSelector.length == 0) {
    documentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }]
  }
  let disableWorkspaceFolders = !!config.disableWorkspaceFolders
  let ignoredRootPaths = config.ignoredRootPaths || []
  ignoredRootPaths = ignoredRootPaths.map(s => s.replace(/^~/, os.homedir()))
  let clientOptions: LanguageClientOptions = {
    ignoredRootPaths,
    disableWorkspaceFolders,
    disableDynamicRegister: !!config.disableDynamicRegister,
    disableCompletion: !!config.disableCompletion,
    disableDiagnostics: !!config.disableDiagnostics,
    documentSelector,
    revealOutputChannelOn: getRevealOutputChannelOn(config.revealOutputChannelOn),
    synchronize: {
      configurationSection: `${id}.settings`
    },
    diagnosticCollectionName: name,
    outputChannelName: id,
    stdioEncoding: config.stdioEncoding || 'utf8',
    initializationOptions: config.initializationOptions || {}
  }
  return [clientOptions, serverOptions]
}

export function getRevealOutputChannelOn(revealOn: string | undefined): RevealOutputChannelOn {
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
      return RevealOutputChannelOn.Never
  }
}

export function getTransportKind(config: LanguageServerConfig): Transport {
  let { transport, transportPort } = config
  if (!transport || transport == 'ipc') return TransportKind.ipc
  if (transport == 'stdio') return TransportKind.stdio
  if (transport == 'pipe') return TransportKind.pipe
  return { kind: TransportKind.socket, port: transportPort }
}

function getForkOptions(config: LanguageServerConfig): ForkOptions {
  return {
    cwd: config.cwd,
    execArgv: config.execArgv || [],
    env: config.env || undefined
  }
}

function getSpawnOptions(config: LanguageServerConfig): SpawnOptions {
  return {
    cwd: config.cwd,
    detached: !!config.detached,
    shell: !!config.shell,
    env: config.env || undefined
  }
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
