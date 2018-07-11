/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {Diagnostic, DiagnosticSeverity, Disposable} from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import {DiagnosticKind} from '../../types'
import {disposeAll} from '../../util'
import workspace from '../../workspace'
import LanguageProvider from './languageProvider'
import * as Proto from './protocol'
import * as PConst from './protocol.const'
import TypeScriptServiceClient from './typescriptServiceClient'
import {LanguageDescription} from './utils/languageDescription'
import {errorMsg} from './utils/nvimBinding'
import * as typeConverters from './utils/typeConverters'
import TypingsStatus, {AtaProgressReporter} from './utils/typingsStatus'
const logger = require('../../util/logger')('tsserver-clienthost')

// Style check diagnostics that can be reported as warnings
const styleCheckDiagnostics = [
  6133, // variable is declared but never used
  6138, // property is declared but its value is never read
  7027, // unreachable code detected
  7028, // unused label
  7029, // fall through case in switch
  7030 // not all code paths return a value
]

export default class TypeScriptServiceClientHost implements Disposable {
  private readonly ataProgressReporter: AtaProgressReporter
  private readonly typingsStatus: TypingsStatus
  private readonly client: TypeScriptServiceClient
  private readonly languages: LanguageProvider[] = []
  private readonly languagePerId = new Map<string, LanguageProvider>()
  private readonly disposables: Disposable[] = []
  private reportStyleCheckAsWarnings = true

  constructor(descriptions: LanguageDescription[]) {
    const handleProjectChange = () => {
      setTimeout(() => {
        this.triggerAllDiagnostics()
      }, 1500)
    }

    const configFileWatcher = workspace.createFileSystemWatcher('**/[tj]sconfig.json')
    if (configFileWatcher) {
      this.disposables.push(configFileWatcher)
      configFileWatcher.onDidCreate(
        this.reloadProjects,
        this,
        this.disposables
      )
      configFileWatcher.onDidDelete(
        this.reloadProjects,
        this,
        this.disposables
      )
      configFileWatcher.onDidChange(handleProjectChange, this, this.disposables)
    }

    this.client = new TypeScriptServiceClient()
    this.disposables.push(this.client)
    this.client.onDiagnosticsReceived(({kind, resource, diagnostics}) => {
      this.diagnosticsReceived(kind, resource, diagnostics).catch(() => {
        // noop
      })
    }, null, this.disposables)

    this.client.onConfigDiagnosticsReceived(diag => {
      let {body} = diag
      if (body) {
        let {configFile, diagnostics} = body
        if (diagnostics.length) {
          errorMsg(`Issue found with config file: ${configFile}`)
        }
      }
    }, null, this.disposables)

    this.client.onResendModelsRequested(() => this.populateService(), null, this.disposables)
    this.typingsStatus = new TypingsStatus(this.client)
    this.ataProgressReporter = new AtaProgressReporter(this.client)
    for (const description of descriptions) { // tslint:disable-line
      const manager = new LanguageProvider(
        this.client,
        description,
        this.typingsStatus
      )
      this.languages.push(manager)
      this.disposables.push(manager)
      this.languagePerId.set(description.id, manager)
    }

    this.client.ensureServiceStarted()
    this.client.onTsServerStarted(() => {
      this.triggerAllDiagnostics()
    })
    this.configurationChanged()
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.typingsStatus.dispose()
    this.ataProgressReporter.dispose()
  }

  public get serviceClient(): TypeScriptServiceClient {
    return this.client
  }

  public reloadProjects(): void {
    this.client.execute('reloadProjects', null, false) // tslint:disable-line
    this.triggerAllDiagnostics()
  }

  // typescript or javascript
  public getProvider(languageId: string): LanguageProvider {
    return this.languagePerId.get(languageId)
  }

  private configurationChanged(): void {
    const config = workspace.getConfiguration('tsserver')
    this.reportStyleCheckAsWarnings = config.get('reportStyleChecksAsWarnings', true)
  }

  private async findLanguage(resource: Uri): Promise<LanguageProvider | undefined> {
    try {
      return this.languages.find(language => language.handles(resource))
    } catch {
      return undefined
    }
  }

  private triggerAllDiagnostics(): void {
    for (const language of this.languagePerId.values()) {
      language.triggerAllDiagnostics()
    }
  }

  private populateService(): void {
    // See https://github.com/Microsoft/TypeScript/issues/5530
    workspace.saveAll(false).then(() => {
      for (const language of this.languagePerId.values()) {
        language.reInitialize()
      }
    }, () => {
      // noop
    })
  }

  private async diagnosticsReceived(
    kind: DiagnosticKind,
    resource: Uri,
    diagnostics: Proto.Diagnostic[]
  ): Promise<void> {
    const language = await this.findLanguage(resource)
    if (language) {
      language.diagnosticsReceived(
        kind,
        resource,
        this.createMarkerDatas(diagnostics, language.diagnosticSource))
    }
  }

  private createMarkerDatas(diagnostics: Proto.Diagnostic[], source: string): Diagnostic[] {
    return diagnostics.map(tsDiag => this.tsDiagnosticToLspDiagnostic(tsDiag, source))
  }

  private tsDiagnosticToLspDiagnostic(diagnostic: Proto.Diagnostic, source: string): Diagnostic {
    const {start, end, text} = diagnostic
    const range = {
      start: typeConverters.Position.fromLocation(start),
      end: typeConverters.Position.fromLocation(end)
    }
    return {
      range,
      message: text,
      code: diagnostic.code ? diagnostic.code : null,
      severity: this.getDiagnosticSeverity(diagnostic),
      source: diagnostic.source || 'tsserver',
    }
  }

  private getDiagnosticSeverity(diagnostic: Proto.Diagnostic): DiagnosticSeverity {
    if (
      this.reportStyleCheckAsWarnings &&
      this.isStyleCheckDiagnostic(diagnostic.code) &&
      diagnostic.category === PConst.DiagnosticCategory.error
    ) {
      return DiagnosticSeverity.Warning
    }

    switch (diagnostic.category) {
      case PConst.DiagnosticCategory.error:
        return DiagnosticSeverity.Error

      case PConst.DiagnosticCategory.warning:
        return DiagnosticSeverity.Warning

      case PConst.DiagnosticCategory.suggestion:
        return DiagnosticSeverity.Information

      default:
        return DiagnosticSeverity.Error
    }
  }

  private isStyleCheckDiagnostic(code: number | undefined): boolean {
    return code ? styleCheckDiagnostics.indexOf(code) !== -1 : false
  }
}
