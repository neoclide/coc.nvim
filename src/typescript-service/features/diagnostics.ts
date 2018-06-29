import {ResourceMap} from './resourceMap'
import {
  Diagnostic
} from 'vscode-languageserver-protocol'
import {
  DiagnosticCollection
} from '../../types'
import Uri from 'vscode-uri'
import languages from '../../languages'
const logger = require('../../util/logger')('typescript-langauge-diagnostics')

export class DiagnosticSet {
  private _map = new ResourceMap<Diagnostic[]>()

  public set(uri: string, diagnostics: Diagnostic[]):void {
    this._map.set(uri, diagnostics)
  }

  public get(uri: string): Diagnostic[] {
    return this._map.get(uri) || []
  }

  public clear(): void {
    this._map = new ResourceMap<Diagnostic[]>()
  }
}

export enum DiagnosticKind {
  Syntax,
  Semantic,
  Suggestion
}

const allDiagnosticKinds = [
  DiagnosticKind.Syntax,
  DiagnosticKind.Semantic,
  DiagnosticKind.Suggestion
]

export class DiagnosticsManager {
  private readonly _diagnostics = new Map<DiagnosticKind, DiagnosticSet>()
  private readonly _currentDiagnostics: DiagnosticCollection
  private _pendingUpdates = new ResourceMap<any>()
  private _validate = true
  private _enableSuggestions = true

  private readonly updateDelay = 200

  constructor() {
    for (const kind of allDiagnosticKinds) {
      this._diagnostics.set(kind, new DiagnosticSet())
    }

    this._currentDiagnostics = languages.createDiagnosticCollection('tsserver')
  }

  public dispose():void {
    this._currentDiagnostics.dispose()
    for (const value of this._pendingUpdates.values) {
      clearTimeout(value)
    }
    this._pendingUpdates = new ResourceMap<any>()
  }

  public reInitialize():void {
    this._currentDiagnostics.clear()
    for (const diagnosticSet of this._diagnostics.values()) {
      diagnosticSet.clear()
    }
  }

  public set validate(value: boolean) {
    if (this._validate === value) {
      return
    }

    this._validate = value
    if (!value) {
      this._currentDiagnostics.clear()
    }
  }

  public set enableSuggestions(value: boolean) {
    if (this._enableSuggestions === value) {
      return
    }

    this._enableSuggestions = value
    if (!value) {
      this._currentDiagnostics.clear()
    }
  }

  public diagnosticsReceived(
    kind: DiagnosticKind,
    filepath: string,
    diagnostics: Diagnostic[]
  ): void {
    const collection = this._diagnostics.get(kind)
    if (!collection) {
      return
    }
    const uri = Uri.file(filepath).toString()

    if (diagnostics.length === 0) {
      const existing = collection.get(uri)
      if (existing.length === 0) {
        // No need to update
        return
      }
    }

    collection.set(uri, diagnostics)

    this.scheduleDiagnosticsUpdate(uri)
  }

  public delete(uri: string): void {
    this._currentDiagnostics.delete(uri)
  }

  public getDiagnostics(uri: string): Diagnostic[] {
    return this._currentDiagnostics.get(uri) || []
    return []
  }

  private scheduleDiagnosticsUpdate(uri: string):void {
    if (!this._pendingUpdates.has(uri)) {
      this._pendingUpdates.set(
        uri,
        setTimeout(() => this.updateCurrentDiagnostics(uri), this.updateDelay)
      )
    }
  }

  private updateCurrentDiagnostics(uri: string):void {
    if (this._pendingUpdates.has(uri)) {
      clearTimeout(this._pendingUpdates.get(uri))
      this._pendingUpdates.delete(uri)
    }

    if (!this._validate) {
      return
    }

    const allDiagnostics = [
      ...this._diagnostics.get(DiagnosticKind.Syntax)!.get(uri),
      ...this._diagnostics.get(DiagnosticKind.Semantic)!.get(uri),
      ...this.getSuggestionDiagnostics(uri)
    ]
    this._currentDiagnostics.set(uri, allDiagnostics)
  }

  private getSuggestionDiagnostics(uri: string):Diagnostic[] {
    return this._diagnostics
      .get(DiagnosticKind.Suggestion)!
      .get(uri)
      .filter(x => {
        if (!this._enableSuggestions) {
          // Still show unused
          return x.code && x.code == 6133
        }
        return true
      })
  }
}
