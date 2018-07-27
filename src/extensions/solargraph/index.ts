import {Disposable, Emitter, Event} from 'vscode-languageserver-protocol'
import {verifyGemIsCurrent, downloadCore, createConfig} from './util'
import which from 'which'
import commandManager from '../../commands'
import {LanguageClient, State} from '../../language-client/main'
import {IServiceProvider, LanguageServerConfig, ServiceStat} from '../../types'
import {disposeAll, echoErr} from '../../util'
import workspace from '../../workspace'
import {makeLanguageClient} from './language-client'
import { Configuration } from './configuration'
const logger = require('../../util/logger')('extension-solargraph')

export default class SolargraphService implements IServiceProvider {
  public readonly id: string
  public readonly name: string
  public enable: boolean
  public languageIds: string[]
  public readonly state: ServiceStat
  private client: LanguageClient
  private config: LanguageServerConfig
  private _onDidServiceReady = new Emitter<void>()
  private configurations: Configuration
  private readonly disposables: Disposable[] = []
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event

  constructor() {
    this.id = 'solargraph'
    this.name = 'Ruby language server'
    this.state = ServiceStat.Initial
    let config = this.config = workspace
      .getConfiguration()
      .get<LanguageServerConfig>('solargraph')
    let commandPath = config.commandPath || 'solargraph'
    try {
      which.sync(commandPath)
      this.enable = this.config.enable !== false // tslint:disable-line
    } catch (e) {
      this.enable = false
    }
    this.languageIds = config.filetypes || ['ruby']
  }

  public init(): Promise<any> {
    let {config, name} = this
    let applyConfiguration = (config:Configuration) => {
      config.commandPath = config.commandPath || 'solargraph'
      config.useBundler = config.useBundler || false
      config.bundlerPath = config.bundlerPath || 'bundle'
      config.withSnippets = config.withSnippets || false
      config.workspace = workspace.root
    }
    let solargraphConfiguration = this.configurations = new Configuration()
    applyConfiguration(solargraphConfiguration)

    let client = this.client = makeLanguageClient(
      config.filetypes,
      solargraphConfiguration
    )
    client.onDidChangeState(changeEvent => {
      let {oldState, newState} = changeEvent
      let oldStr = oldState == State.Running ? 'running' : 'stopped'
      let newStr = newState == State.Running ? 'running' : 'stopped'
      logger.info(`${name} state change: ${oldStr} => ${newStr}`)
    })
    Object.defineProperty(this, 'state', {
      get: () => {
        return client.serviceState
      }
    })
    client.registerProposedFeatures()
    let disposable = client.start()
    this.disposables.push(disposable)
    // let docuemntProvider = new DocumentProvider(client)
    if ((config as any).checkGemVersion === true) {
      verifyGemIsCurrent()
    }

    return new Promise((resolve):void => { // tslint:disable-line
      client.onReady().then(() => {
        this.registerCommand()
        this._onDidServiceReady.fire(void 0)
        resolve()
      }, e => {
        echoErr(workspace.nvim, 'Solargraph failed to initialize.')
        logger.error(e.message)
        resolve()
      }
      )
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  public registerCommand(): void {
    // Search command
    // this.disposables.push(commandManager.registerCommand('solargraph.search', () => {
    //   workspace.nvim.call('input', ['Search Ruby documentation:']).then(val => {
    //     if (val) {
    //       let uri = 'solargraph:/search?query=' + encodeURIComponent(val)
    //       workspace.nvim.command(`edit +/${val} ${uri}`)
    //       commandManager.executeCommand('solargraph._openDocument', uri)
    //     }
    //   }, () => {
    //     // noop
    //   })
    // }))
    // Check gem version command
    this.disposables.push(commandManager.registerCommand('solargraph.checkGemVersion', () => {
      verifyGemIsCurrent()
    }))
    // Build gem documentation command
    this.disposables.push(commandManager.registerCommand('solargraph.buildGemDocs', () => {
      this.client.sendNotification('$/solargraph/documentGems', {rebuild: false})
    }))
    // Rebuild gems documentation command
    this.disposables.push(commandManager.registerCommand('solargraph.rebuildAllGemDocs', () => {
      this.client.sendNotification('$/solargraph/documentGems', {rebuild: true})
    }))
    this.disposables.push(commandManager.registerCommand('solargraph.config', () => {
      createConfig(this.configurations)
    }))
    this.disposables.push(commandManager.registerCommand('solargraph.downloadCore', () => {
      downloadCore(this.configurations)
    }))
  }

  public async restart(): Promise<any> {
    let {client, config} = this
    if (!client) return
    if (this.state == ServiceStat.Running) {
      await this.stop()
    }
    return new Promise(resolve => { // tslint:disable-line
      if (client) {
        this.dispose()
        let client = this.client = makeLanguageClient(config.filetypes, this.configurations)
        // solargraphDocumentProvider.setLanguageClient(languageClient);
        let disposable = this.client.start()
        this.disposables.push(disposable)
        client.onReady().then(() => {
          this._onDidServiceReady.fire(void 0)
          this.registerCommand()
          resolve()
        }, e => {
          echoErr(workspace.nvim, 'Solargraph failed to initialize.')
          logger.error(e.message)
          resolve()
        })
      } else {
        this.init().then(resolve, _e => {
          // noop
        })
      }
    })

  }

  public async stop(): Promise<void> {
    if (!this.client) return
    await Promise.resolve(this.client.stop())
  }
}
