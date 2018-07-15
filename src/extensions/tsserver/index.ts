import {Disposable, Emitter, Event} from 'vscode-languageserver-protocol'
import {IServiceProvider, ServiceStat} from '../../types'
import {disposeAll} from '../../util/index'
import workspace from '../../workspace'
import TypeScriptServiceClientHost from './typescriptServiceClientHost'
import {standardLanguageDescriptions} from './utils/languageDescription'
import {languageIds} from './utils/languageModeIds'
const logger = require('../../util/logger')('tsserver-index')

export default class TsserverService implements IServiceProvider {
  public id = 'tsserver'
  public name = 'tsserver'
  public enable: boolean
  // supported language types
  public languageIds: string[] = languageIds
  public state = ServiceStat.Initial
  private clientHost: TypeScriptServiceClientHost
  private _onDidServiceReady = new Emitter<void>()
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event
  private readonly disposables: Disposable[] = []

  constructor() {
    const config = workspace.getConfiguration('tsserver')
    const enableJavascript = !!config.get<boolean>('enableJavascript')
    if (!enableJavascript) {
      this.languageIds = languageIds.filter(id => id.indexOf('javascript') == -1)
    }
    this.enable = config.get<boolean>('enable')
  }

  public init(): Promise<void> {
    let {languageIds} = this
    let descriptions = standardLanguageDescriptions.filter(o => languageIds.indexOf(o.id) !== -1)
    this.clientHost = new TypeScriptServiceClientHost(descriptions)
    Object.defineProperty(this, 'state', {
      get: () => {
        return this.clientHost.serviceClient.state
      }
    })
    let client = this.clientHost.serviceClient
    this.disposables.push(client)
    return new Promise(resolve => {
      let started = false
      client.onTsServerStarted(() => {
        this._onDidServiceReady.fire(void 0)
        if (!started) {
          started = true
          resolve()
        }
      })
      setTimeout(() => {
        resolve()
      }, 3000)
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  public async restart(): Promise<void> {
    if (!this.clientHost) return
    let client = this.clientHost.serviceClient
    await client.restartTsServer()
  }

  public async stop(): Promise<void> {
    if (!this.clientHost) return
    let client = this.clientHost.serviceClient
    await client.stop()
    return
  }
}
