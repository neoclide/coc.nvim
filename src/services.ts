'use strict'
import { SpawnOptions } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { CancellationToken, Disposable, DocumentSelector, Emitter, Event, WorkspaceFolder } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { Executable, ForkOptions, LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions, State, Transport, TransportKind } from './language-client'
import { ServiceStat } from './types'
import { disposeAll, wait } from './util'
import window from './window'
import workspace from './workspace'
const logger = require('./util/logger')('services')

interface ServiceInfo {
  id: string
  state: string
  languageIds: string[]
}

export interface LanguageServerConfig {
  module?: string
  command?: string
  transport?: string
  transportPort?: number
  disableSnippetCompletion?: boolean
  disableDynamicRegister?: boolean
  disabledFeatures?: string[]
  formatterPriority?: number
  filetypes: string[]
  additionalSchemes?: string[]
  enable?: boolean
  args?: string[]
  cwd?: string
  env?: any
  // socket port
  port?: number
  host?: string
  detached?: boolean
  shell?: boolean
  execArgv?: string[]
  rootPatterns?: string[]
  requireRootPattern?: boolean
  ignoredRootPaths?: string[]
  initializationOptions?: any
  progressOnInitialization?: boolean
  revealOutputChannelOn?: string
  configSection?: string
  stdioEncoding?: string
  runtime?: string
}

export interface IServiceProvider {
  // unique service id
  id: string
  name: string
  client?: LanguageClient
  selector: DocumentSelector
  // current state
  state: ServiceStat
  start(): Promise<void>
  dispose(): void
  stop(): Promise<void> | void
  restart(): Promise<void> | void
  onServiceReady: Event<void>
}

class ServiceManager implements Disposable {
  private readonly registered: Map<string, IServiceProvider> = new Map()
  private disposables: Disposable[] = []

  public init(): void {
    workspace.onDidOpenTextDocument(document => {
      void this.start(document)
    }, null, this.disposables)
    const iterate = (folders: Iterable<WorkspaceFolder>) => {
      for (let folder of folders) {
        this.registClientsFromFolder(folder)
      }
    }
    workspace.onDidChangeWorkspaceFolders(e => {
      iterate(e.added)
    }, null, this.disposables)
    // Global configured languageserver
    let lspConfig = workspace.getConfiguration(undefined, null).get<{ key: LanguageServerConfig }>('languageserver', {} as any)
    this.registClientsByConfig(lspConfig)
    iterate(workspace.workspaceFolders)
  }

  private registClientsFromFolder(workspaceFolder: WorkspaceFolder): void {
    let uri = URI.parse(workspaceFolder.uri)
    let lspConfig = workspace.getConfiguration(undefined, uri)
    let config = lspConfig.inspect('languageserver').workspaceFolderValue
    if (config) this.registClientsByConfig(config as { [key: string]: LanguageServerConfig }, uri)
  }

  public regist(service: IServiceProvider): Disposable {
    let { id } = service
    if (this.registered.get(id)) return
    this.registered.set(id, service)
    logger.info(`registered service "${id}"`)
    if (this.shouldStart(service)) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      service.start()
    }
    service.onServiceReady(() => {
      logger.info(`service ${id} started`)
    }, null, this.disposables)
    return Disposable.create(() => {
      if (!this.registered.has(id)) return
      service.dispose()
      this.registered.delete(id)
    })
  }

  public getService(id: string): IServiceProvider {
    let service = this.registered.get(id)
    if (!service) service = this.registered.get(`languageserver.${id}`)
    return service
  }

  private shouldStart(service: IServiceProvider): boolean {
    if (service.state != ServiceStat.Initial) return false
    let selector = service.selector
    for (let doc of workspace.documents) {
      if (workspace.match(selector, doc.textDocument)) {
        return true
      }
    }
    return false
  }

  public async start(document: TextDocument): Promise<void> {
    let services: IServiceProvider[] = []
    for (let service of this.registered.values()) {
      if (service.state == ServiceStat.Initial && workspace.match(service.selector, document) > 0) {
        services.push(service)
      }
    }
    await Promise.allSettled(services.map(service => {
      return service.start()
    }))
  }

  public stop(id: string): Promise<void> {
    let service = this.registered.get(id)
    if (service) return Promise.resolve(service.stop())
  }

  public async toggle(id: string): Promise<void> {
    let service = this.registered.get(id)
    if (!service) throw new Error(`Service ${id} not found`)
    let { state } = service
    if (state == ServiceStat.Running) {
      await Promise.resolve(service.stop())
    } else if (state == ServiceStat.Initial || state == ServiceStat.StartFailed) {
      await service.start()
    } else if (state == ServiceStat.Stopped) {
      await service.restart()
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

  private registClientsByConfig(lspConfig: { [key: string]: LanguageServerConfig }, folder?: URI): void {
    for (let key of Object.keys(lspConfig)) {
      let config: LanguageServerConfig = lspConfig[key]
      if (!isValidServerConfig(key, config)) {
        continue
      }
      this.registLanguageClient(key, config, folder)
    }
  }

  private async getLanguageClient(id: string): Promise<LanguageClient> {
    let service = this.getService(id)
    // wait for extension activate
    if (!service) await wait(100)
    service = this.getService(id)
    if (!service || !service.client) {
      throw new Error(`Language server ${id} not found`)
    }
    return service.client
  }

  public async sendNotification(id: string, method: string, params?: any): Promise<void> {
    let client = await this.getLanguageClient(id)
    await Promise.resolve(client.sendNotification(method, params))
  }

  public async sendRequest(id: string, method: string, params?: any, token?: CancellationToken): Promise<any> {
    let client = await this.getLanguageClient(id)
    token = token ?? CancellationToken.None
    return await Promise.resolve(client.sendRequest(method, params, token))
  }

  public async registNotification(id: string, method: string): Promise<void> {
    let client = await this.getLanguageClient(id)
    client.onNotification(method, async result => {
      workspace.nvim.call('coc#do_notify', [id, method, result], true)
    })
  }

  public registLanguageClient(client: LanguageClient): Disposable
  public registLanguageClient(name: string, config: LanguageServerConfig, folder?: URI): Disposable
  public registLanguageClient(name: string | LanguageClient, config?: LanguageServerConfig, folder?: URI): Disposable {
    let id = typeof name === 'string' ? `languageserver.${name}` : name.id
    let disposables: Disposable[] = []
    let onDidServiceReady = new Emitter<void>()
    let client: LanguageClient | null = typeof name === 'string' ? null : name
    if (this.registered.has(id)) return Disposable.create(() => {})
    if (client && typeof client.dispose === 'function') disposables.push(client)
    let created = false
    let service: IServiceProvider = {
      id,
      client,
      name: typeof name === 'string' ? name : name.name,
      selector: typeof name === 'string' ? getDocumentSelector(config.filetypes, config.additionalSchemes) : name.clientOptions.documentSelector,
      state: client && client.state === State.Running ? ServiceStat.Running : ServiceStat.Initial,
      onServiceReady: onDidServiceReady.event,
      start: async (): Promise<void> => {
        if (!created) {
          if (typeof name == 'string' && !client) {
            let config: LanguageServerConfig = workspace.getConfiguration(undefined, folder).get(`languageserver.${name}`, {} as any)
            let opts = getLanguageServerOptions(id, name, config, folder)
            if (!opts || config.enable === false) return
            client = new LanguageClient(id, name, opts[1], opts[0])
            service.selector = opts[0].documentSelector
            service.client = client
            disposables.push(client)
          }
          created = true
          client.onDidChangeState(changeEvent => {
            let { oldState, newState } = changeEvent
            service.state = converState(newState)
            let oldStr = stateString(oldState)
            let newStr = stateString(newState)
            logger.info(`LanguageClient ${client.name} state change: ${oldStr} => ${newStr}`)
          }, null, disposables)
        }
        try {
          if (!client.needsStart()) {
            service.state = converState(client.state)
          } else {
            service.state = ServiceStat.Starting
            logger.debug(`starting service: ${id}`)
            await client.start()
            onDidServiceReady.fire(void 0)
          }
        } catch (e) {
          void window.showErrorMessage(`Server ${id} failed to start: ${e}`)
          logger.error(`Server ${id} failed to start:`, e)
          service.state = ServiceStat.StartFailed
        }
      },
      dispose: async () => {
        onDidServiceReady.dispose()
        disposeAll(disposables)
      },
      stop: async (): Promise<void> => {
        if (!client || !client.needsStop()) return
        await Promise.resolve(client.stop())
      },
      restart: async (): Promise<void> => {
        if (client) {
          service.state = ServiceStat.Starting
          await client.restart()
        } else {
          await service.start()
        }
      },
    }
    return this.regist(service)
  }

  public dispose(): void {
    disposeAll(this.disposables)
    for (let service of this.registered.values()) {
      service.dispose()
    }
    this.registered.clear()
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
  return Array.from(new Set(res))
}

// convert config to options
export function getLanguageServerOptions(id: string, name: string, config: Readonly<LanguageServerConfig>, folder?: URI): [LanguageClientOptions, ServerOptions] {
  let { command, module, port, args, filetypes } = config
  args = args || []
  if (!filetypes) {
    void window.showErrorMessage(`Wrong configuration of LS "${name}", filetypes not found`)
    return null
  }
  if (!command && !module && !port) {
    void window.showErrorMessage(`Wrong configuration of LS "${name}", no command or module specified.`)
    return null
  }
  let serverOptions: ServerOptions
  if (module) {
    module = workspace.expand(module)
    if (!fs.existsSync(module)) {
      void window.showErrorMessage(`Module file "${module}" not found for LS "${name}"`)
      return null
    }
    serverOptions = {
      module,
      runtime: config.runtime ?? process.execPath,
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
  } else {
    serverOptions = () => new Promise((resolve, reject) => {
      let client = new net.Socket()
      let host = config.host ?? '127.0.0.1'
      logger.info(`languageserver "${id}" connecting to ${host}:${port}`)
      client.connect(port, host, () => {
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
  // compatible
  let disabledFeatures: string[] = Array.from(config.disabledFeatures || [])
  for (let key of ['disableWorkspaceFolders', 'disableCompletion', 'disableDiagnostics']) {
    if (config[key] === true) {
      logger.warn(`Language server config "${key}" is deprecated, use "disabledFeatures" instead.`)
      let s = key.slice(7)
      disabledFeatures.push(s[0].toLowerCase() + s.slice(1))
    }
  }
  let disableSnippetCompletion = !!config.disableSnippetCompletion
  let ignoredRootPaths = config.ignoredRootPaths ?? []
  let clientOptions: LanguageClientOptions = {
    workspaceFolder: folder == null ? undefined : { name: path.basename(folder.fsPath), uri: folder.toString() },
    rootPatterns: config.rootPatterns,
    requireRootPattern: config.requireRootPattern,
    ignoredRootPaths: ignoredRootPaths.map(s => workspace.expand(s)),
    disableSnippetCompletion,
    disableDynamicRegister: !!config.disableDynamicRegister,
    disabledFeatures,
    formatterPriority: config.formatterPriority,
    documentSelector: getDocumentSelector(config.filetypes, config.additionalSchemes),
    revealOutputChannelOn: getRevealOutputChannelOn(config.revealOutputChannelOn),
    synchronize: {
      configurationSection: `${id}.settings`
    },
    diagnosticCollectionName: name,
    outputChannelName: id,
    stdioEncoding: config.stdioEncoding,
    progressOnInitialization: config.progressOnInitialization === true,
    initializationOptions: config.initializationOptions ?? {}
  }
  return [clientOptions, serverOptions]
}

export function isValidServerConfig(key: string, config: Partial<LanguageServerConfig>): boolean {
  let errors: string[] = []
  let fields = ['module', 'command', 'transport']
  for (let field of fields) {
    let val = config[field]
    if (val && typeof val !== 'string') {
      errors.push(`"${field}" field of languageserver ${key} should be string`)
    }
  }
  if (config.transportPort != null && typeof config.transportPort !== 'number') {
    errors.push(`"transportPort" field of languageserver ${key} should be number`)
  }
  if (!Array.isArray(config.filetypes) || !config.filetypes.every(s => typeof s === 'string')) {
    errors.push(`"filetypes" field of languageserver ${key} should be array of string`)
  }
  if (config.additionalSchemes && (!Array.isArray(config.additionalSchemes) || config.additionalSchemes.some(s => typeof s !== 'string'))) {
    errors.push(`"additionalSchemes" field of languageserver ${key} should be array of string`)
  }
  if (errors.length) {
    void window.showErrorMessage(errors.join('\n'))
    return false
  }
  return true
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

export function getDocumentSelector(filetypes: string[] | undefined, additionalSchemes?: string[]): DocumentSelector {
  let documentSelector: DocumentSelector = []
  let schemes = ['file', 'untitled'].concat(additionalSchemes || [])
  if (!filetypes) return schemes.map(s => ({ scheme: s }))
  filetypes.forEach(filetype => {
    documentSelector.push(...schemes.map(scheme => ({ language: filetype, scheme })))
  })
  return documentSelector
}

export function getTransportKind(config: LanguageServerConfig): Transport {
  let { transport, transportPort } = config
  if (!transport || transport == 'ipc') return TransportKind.ipc
  if (transport == 'stdio') return TransportKind.stdio
  if (transport == 'pipe') return TransportKind.pipe
  return { kind: TransportKind.socket, port: transportPort }
}

export function getForkOptions(config: LanguageServerConfig): ForkOptions {
  return {
    cwd: config.cwd,
    execArgv: config.execArgv ?? [],
    env: config.env ?? undefined
  }
}

export function getSpawnOptions(config: LanguageServerConfig): SpawnOptions {
  return {
    cwd: config.cwd,
    detached: !!config.detached,
    shell: !!config.shell,
    env: config.env ?? undefined
  }
}

export function converState(state: State): ServiceStat {
  switch (state) {
    case State.Running:
      return ServiceStat.Running
    case State.Starting:
      return ServiceStat.Starting
    case State.Stopped:
      return ServiceStat.Stopped
    default:
      return undefined
  }
}

export function stateString(state: State): string {
  switch (state) {
    case State.Running:
      return 'running'
    case State.Starting:
      return 'starting'
    case State.Stopped:
      return 'stopped'
    default:
      return 'unknown'
  }
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

export default new ServiceManager()
