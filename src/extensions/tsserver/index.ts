import { Disposable, Emitter, Event, TextEdit } from 'vscode-languageserver-protocol'
import { IServiceProvider, ServiceStat, WorkspaceConfiguration, TextDocumentWillSaveEvent } from '../../types'
import { disposeAll } from '../../util/index'
import workspace from '../../workspace'
import languages from '../../languages'
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

  public get config(): WorkspaceConfiguration {
    return workspace.getConfiguration('tsserver')
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
        workspace.onWillSaveUntil(this.onWillSave, this, 'tsserver')
        if (!started) {
          started = true
          resolve()
        }
      })
    })
  }

  private onWillSave(event: TextDocumentWillSaveEvent): void {
    let formatOnSave = this.config.get('formatOnSave')
    if (!formatOnSave) return
    let { languageId } = event.document
    if (languageIds.indexOf(languageId) == -1) return
    if (this.state != ServiceStat.Running) return
    let willSaveWaitUntil = async (event: TextDocumentWillSaveEvent): Promise<TextEdit[]> => {
      let options = await workspace.getFormatOptions(event.document.uri)
      let textEdits = await languages.provideDocumentFormattingEdits(event.document, options)
      return textEdits
    }
    event.waitUntil(willSaveWaitUntil(event))
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
