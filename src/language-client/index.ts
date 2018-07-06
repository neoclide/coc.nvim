import fs from 'fs'
import path from 'path'
import {Disposable, Emitter, Event} from 'vscode-languageserver-protocol'
import which from 'which'
import {ExecutableOptions, ForkOptions, LanguageClient, LanguageClientOptions, ServerOptions, State, TransportKind} from '../language-client/main'
import {IServiceProvider, LanguageServerConfig, ServiceStat} from '../types'
import {disposeAll, echoErr} from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('language-client-index')

export interface LspConfig {
  [index: string]: LanguageServerConfig
}

export class LanguageService implements IServiceProvider {
  public enable: boolean
  public languageIds: string[]
  public readonly state: ServiceStat
  private configSections: string | string[]
  protected client:LanguageClient
  private _onDidServiceReady = new Emitter<void>()
  private readonly disposables: Disposable[] = []
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event

  constructor(
    public readonly id:string,
    public readonly name:string,
    private config:LanguageServerConfig,
    configSections?:string|string[]
  ) {
    this.state = ServiceStat.Initial
    this.enable = config.enable
    this.languageIds = config.filetypes
    this.configSections = configSections || `${this.id}.settings`
    if (!config.command && !config.module) {
      echoErr(workspace.nvim, `Command and module not found for ${id}`)
      logger.error(`invalid command of ${id}`)
      this.enable = false
    }
  }

  public init ():void {
    let {config, name} = this
    let {args, module} = config

    let isModule = config.module || args.indexOf('--node-ipc') !== -1
    if (!module && args.indexOf('--node-ipc') !== -1) {
      try {
        module = which.sync(config.command)
      } catch (e) {
        logger.error(e.message)
        echoErr(workspace.nvim, `Executable ${config.command} not found`).catch(() => {
          // noop
        })
        this.enable = false
        return
      }
    }

    let serverOptions: ServerOptions = isModule ? {
      module,
      transport: TransportKind.ipc,
      args: config.args,
      options: this.getOptions(true)
    } : {
      command: config.command,
      args: config.args || [],
      options: this.getOptions()
    }

    let documentSelector = this.languageIds
    let clientOptions: LanguageClientOptions = {
      documentSelector,
      synchronize: {
        configurationSection: this.configSections
      },
      initializationOptions: config.initializationOptions || {}
    }
    clientOptions = this.resolveClientOptions(clientOptions)
    // Create the language client and start the client.
    let client = this.client = new LanguageClient(
      this.id,
      name,
      serverOptions,
      clientOptions)

    client.onDidChangeState(changeEvent => {
      let {oldState, newState} = changeEvent
      let oldStr = oldState == State.Running ? 'running' : 'stopped'
      let newStr = newState == State.Running ? 'running' : 'stopped'
      logger.info(`${name} state change: ${oldStr} => ${newStr}`)
    })
    Object.defineProperty(this, 'state', {
      get: () => {
        client.serviceState
      }
    })
    client.registerProposedFeatures()
    let disposable = client.start()
    client.onReady().then(() => {
      this._onDidServiceReady.fire(void 0)
    }, e => {
      logger.error(e.message)
    })
    this.disposables.push(disposable)
  }

  protected resolveClientOptions(clientOptions:LanguageClientOptions):LanguageClientOptions {
    return clientOptions
  }

  private getOptions(isModule = false):ExecutableOptions | ForkOptions {
    let {config} = this
    let {cwd, shell, execArgv} = config
    cwd = cwd ? path.isAbsolute(cwd) ? cwd
      : path.resolve(workspace.root, cwd)
      : workspace.root
    try {
      fs.statSync(cwd)
    } catch (e) {
      cwd = workspace.root
    }
    if (isModule) return {cwd, execArgv: execArgv || []}
    return {
      cwd,
      detached: false,
      shell: !!shell
    }
  }

  public dispose():void {
    disposeAll(this.disposables)
  }

  public async restart():Promise<void> {
    if (!this.client) return
    if (this.state == ServiceStat.Running) {
      await this.stop()
    }
    this.client.restart()
  }

  public async stop():Promise<void> {
    if (!this.client) return
    await Promise.resolve(this.client.stop())
  }
}

class LanguageClientManager {
  private _services:IServiceProvider[] = []

  public init():void {
    let base = 'languageserver'
    let lspConfig = workspace.getConfiguration().get<{string, LanguageServerConfig}>(base)
    for (let key of Object.keys(lspConfig)) {
      let config = workspace.getConfiguration(base).get<LanguageServerConfig>(key)
      let id = `${base}.${key}`
      this._services.push(
        new LanguageService(id, key, config)
      )
    }
  }

  public get services():IServiceProvider[] {
    return this._services || []
  }
}

export default new LanguageClientManager()
