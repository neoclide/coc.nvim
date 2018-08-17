import { Disposable, Emitter, Event, TextEdit } from 'vscode-languageserver-protocol'
import URI from 'vscode-uri'
import commandManager from '../../commands'
import languages from '../../languages'
import { IServiceProvider, ServiceStat, TextDocumentWillSaveEvent, WorkspaceConfiguration } from '../../types'
import { disposeAll, wait } from '../../util'
import workspace from '../../workspace'
import { OpenTsServerLogCommand, ReloadProjectsCommand, TypeScriptGoToProjectConfigCommand } from './commands'
import TypeScriptServiceClientHost from './typescriptServiceClientHost'
import { LanguageDescription, standardLanguageDescriptions } from './utils/languageDescription'
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
    this.registerCommands()
    workspace.onWillSaveUntil(this.onWillSave, this, 'tsserver')
    return new Promise(resolve => {
      let started = false
      client.onTsServerStarted(() => {
        this._onDidServiceReady.fire(void 0)
        this.ensureConfiguration() // tslint:disable-line
        if (!started) {
          started = true
          resolve()
        }
      })
    })
  }

  private async ensureConfiguration(): Promise<void> {
    if (!this.clientHost) return
    let document = await workspace.document
    await wait(200)

    let uri = URI.parse(document.uri)
    let language = this.clientHost.findLanguage(uri)
    if (!language) return
    await language.fileConfigurationManager.ensureConfigurationForDocument(document.textDocument)
  }

  private registerCommands(): void {
    commandManager.register(new ReloadProjectsCommand(this.clientHost))
    commandManager.register(new OpenTsServerLogCommand(this.clientHost))
    commandManager.register(new TypeScriptGoToProjectConfigCommand(this.clientHost))
    commandManager.register({
      id: 'tsserver.restart',
      execute: async (): Promise<void> => {
        await this.stop()
        await wait(100)
        await this.restart()
      }
    })
  }

  private onWillSave(event: TextDocumentWillSaveEvent): void {
    if (this.state != ServiceStat.Running) return
    let formatOnSave = this.config.get<boolean>('formatOnSave')
    if (!formatOnSave) return
    let { languageId } = event.document
    if (languageIds.indexOf(languageId) == -1) return
    let willSaveWaitUntil = async (): Promise<TextEdit[]> => {
      let options = await workspace.getFormatOptions(event.document.uri)
      let textEdits = await languages.provideDocumentFormattingEdits(event.document, options)
      return textEdits
    }
    event.waitUntil(willSaveWaitUntil())
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
    this.clientHost.reset()
    let client = this.clientHost.serviceClient
    await client.stop()
    return
  }
}
