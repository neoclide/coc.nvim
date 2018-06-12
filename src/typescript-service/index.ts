import workspace from '../workspace'
import {
  IServiceProvider,
  ServiceStat,
  EventEmitter,
  Disposable,
  Event,
} from '../types'
import {
  disposeAll
} from '../util/index'
import {
  standardLanguageDescriptions
} from './utils/languageDescription'
import {
  languageIds
} from './utils/languageModeIds'
import TypeScriptServiceClientHost from './typescriptServiceClientHost'
const logger = require('../util/logger')('typescript-service-index')

export default class TsserverService implements IServiceProvider {
  public name = 'tsserver'
  // supported language types
  public languageIds:string[]
  public state = ServiceStat.Init
  private clientHost: TypeScriptServiceClientHost
  private _onDidServiceReady = new EventEmitter<void>()
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event
  private readonly disposables: Disposable[] = []

  constructor() {
    const config = workspace.getConfiguration('tsserver')
    const enableJavascript = !!config.get<boolean>('enableJavascript')
    let ids = languageIds
    if (!enableJavascript) {
      ids = ids.filter(id => id.indexOf('javascript') == -1)
    }
    this.languageIds = ids
  }

  public init():void {
    let {languageIds} = this
    let descriptions = standardLanguageDescriptions.filter(o => languageIds.indexOf(o.id) !== -1)
    this.clientHost = new TypeScriptServiceClientHost(descriptions)
    Object.defineProperty(this, 'state', {
      get: () => {
        return this.clientHost.serviceClient.state
      }
    })
    let client = this.clientHost.serviceClient
    client.onTsServerStarted(() => {
      this._onDidServiceReady.fire()
    })
    this.disposables.push(client)
  }

  public dispose():void {
    disposeAll(this.disposables)
  }

  public restart():void {
    if (!this.clientHost) return
    let client = this.clientHost.serviceClient
    client.restartTsServer()
  }
}
