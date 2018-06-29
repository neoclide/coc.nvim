import workspace from '../workspace'
import * as path from 'path'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  State,
} from '../language-client/main'
import {
  Disposable,
  Emitter,
  Event,
} from 'vscode-languageserver-protocol'
import {
  IServiceProvider,
  ServiceStat,
} from '../types'
import {
  disposeAll,
  ROOT,
} from '../util'
const logger = require('../util/logger')('css-service')

const ID = 'cssserver'

export default class CssService implements IServiceProvider {
  public name = ID
  public enable:boolean
  public languageIds:string[] = ['css', 'less', 'scss']
  private _onDidServiceReady = new Emitter<void>()
  private readonly disposables: Disposable[] = []
  private client:LanguageClient
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event
  public state = ServiceStat.Initial

  constructor() {
    const config = workspace.getConfiguration(ID)
    this.enable = config.get<boolean>('enable')
    let languageIds = config.get<string[]>('filetypes')
    if (languageIds) this.languageIds = languageIds
  }

  public init():void {
    let serverModule = path.join(ROOT, 'lib/css/server.js')
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6044'] }

    let serverOptions: ServerOptions = {
      run: {module: serverModule, transport: TransportKind.ipc},
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: debugOptions
      }
    }
    let documentSelector = this.languageIds

    let clientOptions: LanguageClientOptions = {
      documentSelector,
      synchronize: {
        configurationSection: this.languageIds,
      },
      initializationOptions: {}
    }

    let name = 'CSS Language Server'
    // Create the language client and start the client.
    let client = this.client = new LanguageClient(ID, name, serverOptions, clientOptions)
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
