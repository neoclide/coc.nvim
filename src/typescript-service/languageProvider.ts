import languages from '../languages'
import workspace from '../workspace'
import {
  Diagnostic,
} from 'vscode-languageserver-protocol'
import {
  Disposable,
  Uri,
  disposeAll,
} from '../util'
import {
  DiagnosticKind,
  ServiceStat,
} from '../types'
import { DiagnosticsManager } from './features/diagnostics'
import TypeScriptServiceClient from './typescriptServiceClient'
import BufferSyncSupport from './features/bufferSyncSupport'
import CompletionItemProvider from './features/completionItemProvider'
import DefinitionProvider from './features/definitionProvider'
import ReferenceProvider from './features/references'
import HoverProvider from './features/hover'
import SignatureHelpProvider from './features/signatureHelp'
import DocumentSymbolProvider from './features/documentSymbol'
import FormattingProvider from './features/formatting'
import RenameProvider from './features/rename'
import WorkspaceSymbolProvider from './features/workspaceSymbols'
import TypingsStatus from './utils/typingsStatus'
import FileConfigurationManager from './features/fileConfigurationManager'
import {LanguageDescription} from './utils/languageDescription'
const logger = require('../util/logger')('typescript-langauge-provider')

const validateSetting = 'validate.enable'
const suggestionSetting = 'suggestionActions.enabled'

export default class LanguageProvider {
  private readonly diagnosticsManager: DiagnosticsManager
  private readonly bufferSyncSupport: BufferSyncSupport
  private readonly fileConfigurationManager: FileConfigurationManager // tslint:disable-line
  private _validate = true
  private _enableSuggestionDiagnostics = true
  private readonly disposables: Disposable[] = []

  constructor(
    public client: TypeScriptServiceClient,
    private description: LanguageDescription,
    typingsStatus: TypingsStatus
  ) {
    this.fileConfigurationManager = new FileConfigurationManager(client)
    this.bufferSyncSupport = new BufferSyncSupport(
      client,
      description.modeIds,
      this._validate
    )
    this.diagnosticsManager = new DiagnosticsManager()

    workspace.onDidEnterTextDocument(info => {
      let {state} = client
      let cb = () => {
        let {languageId, expandtab, tabstop} = info
        this.fileConfigurationManager.ensureConfigurationOptions(languageId, expandtab, tabstop) // tslint:disable-line
      }
      if (state == ServiceStat.Running) {
        cb()
      } else {
        client.onTsServerStarted(cb)
      }
    })

    workspace.onDidChangeConfiguration(this.configurationChanged, this, this.disposables)

    client.onTsServerStarted(async () => { // tslint:disable-line
      await this.registerProviders(client, typingsStatus)
      this.bufferSyncSupport.listen()
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.bufferSyncSupport.dispose()
  }

  private configurationChanged(): void {
    const config = workspace.getConfiguration(this.id)
    this.updateValidate(config.get(validateSetting, true))
    this.updateSuggestionDiagnostics(config.get(suggestionSetting, true))
  }

  private async registerProviders(
    client: TypeScriptServiceClient,
    typingsStatus: TypingsStatus
  ): Promise<void> {
    let languageIds = this.description.modeIds
    this.disposables.push(
      languages.registerCompletionItemProvider(
        'tsserver',
        'TSC',
        languageIds,
        new CompletionItemProvider(
          client,
          typingsStatus,
          this.fileConfigurationManager
        ),
        CompletionItemProvider.triggerCharacters
      )
    )
    let definitionProvider = new DefinitionProvider(client)

    this.disposables.push(
      languages.registerDefinitionProvider(
        languageIds,
        definitionProvider
      )
    )

    this.disposables.push(
      languages.registerTypeDefinitionProvider(
        languageIds,
        definitionProvider
      )
    )

    this.disposables.push(
      languages.registerImplementationProvider(
        languageIds,
        definitionProvider
      )
    )

    this.disposables.push(
      languages.registerReferencesProvider(
        languageIds,
        new ReferenceProvider(client)
      )
    )

    this.disposables.push(
      languages.registerHoverProvider(
        languageIds,
        new HoverProvider(client))
    )

    this.disposables.push(
      languages.registerSignatureHelpProvider(
        languageIds,
        new SignatureHelpProvider(client))
    )

    this.disposables.push(
      languages.registerDocumentSymbolProvider(
        languageIds,
        new DocumentSymbolProvider(client))
    )

    this.disposables.push(
      languages.registerWorkspaceSymbolProvider(
        languageIds,
        new WorkspaceSymbolProvider(client, languageIds))
    )

    this.disposables.push(
      languages.registerRenameProvider(
        languageIds,
        new RenameProvider(client))
    )
    let formatProvider = new FormattingProvider(client, this.fileConfigurationManager)
    this.disposables.push(
      languages.registerDocumentFormatProvider(languageIds, formatProvider)
    )
    this.disposables.push(
      languages.registerDocumentRangeFormatProvider(languageIds, formatProvider)
    )
  }

  public handles(resource: Uri): boolean {
    let fsPath = resource.fsPath
    if (this.id === 'typescript' && /ts(x)?$/.test(fsPath)) {
      return true
    }
    if (this.id === 'javascript' && /js(x)?$/.test(fsPath)) {
      return true
    }
    return false
  }

  private get id(): string { // tslint:disable-line
    return this.description.id
  }

  public get diagnosticSource(): string {
    return this.description.diagnosticSource
  }

  private updateValidate(value: boolean):void {
    if (this._validate === value) {
      return
    }
    this._validate = value
    this.bufferSyncSupport.validate = value
    this.diagnosticsManager.validate = value
    if (value) {
      this.triggerAllDiagnostics()
    }
  }

  private updateSuggestionDiagnostics(value: boolean):void {
    if (this._enableSuggestionDiagnostics === value) {
      return
    }
    this._enableSuggestionDiagnostics = value
    this.diagnosticsManager.enableSuggestions = value
    if (value) {
      this.triggerAllDiagnostics()
    }
  }

  public reInitialize(): void {
    this.diagnosticsManager.reInitialize()
    this.bufferSyncSupport.requestAllDiagnostics()
  }

  public triggerAllDiagnostics(): void {
    this.bufferSyncSupport.requestAllDiagnostics()
  }

  public diagnosticsReceived(
    diagnosticsKind: DiagnosticKind,
    file: Uri,
    diagnostics: Diagnostic[]
  ): void {
    let uri = file.fsPath
    if (!uri) return
    this.diagnosticsManager.diagnosticsReceived(
      diagnosticsKind,
      uri,
      diagnostics
    )
  }
}
