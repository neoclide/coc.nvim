import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { IServiceProvider, ServiceStat } from '../../types'
import { disposeAll } from '../../util/index'
import workspace from '../../workspace'
import TypeScriptServiceClientHost from './typescriptServiceClientHost'
import { standardLanguageDescriptions, LanguageDescription } from './utils/languageDescription'
import { languageIds } from './utils/languageModeIds'
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
  private descriptions: LanguageDescription[] = []

  constructor() {
    const config = workspace.getConfiguration('tsserver')
    const enableJavascript = !!config.get<boolean>('enableJavascript')
    this.enable = config.get<boolean>('enable')
    this.descriptions = standardLanguageDescriptions.filter(o => {
      return enableJavascript ? true : o.id != 'javascript'
    })
    this.languageIds = this.descriptions.reduce((arr, c) => {
      return arr.concat(c.modeIds)
    }, [])
  }

  public init(): Promise<void> {
    this.clientHost = new TypeScriptServiceClientHost(this.descriptions)
    this.disposables.push(this.clientHost)
    Object.defineProperty(this, 'state', {
      get: () => {
        return this.clientHost.serviceClient.state
      }
    })
    let client = this.clientHost.serviceClient
    return new Promise(resolve => {
      let started = false
      client.onTsServerStarted(() => {
        this._onDidServiceReady.fire(void 0)
        if (!started) {
          started = true
          resolve()
        }
      })
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
