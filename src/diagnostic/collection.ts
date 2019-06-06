import { Diagnostic, Emitter, Event } from 'vscode-languageserver-protocol'
import { DiagnosticCollection } from '../types'
import { URI } from 'vscode-uri'
import { emptyRange } from '../util/position'
const logger = require('../util/logger')('diagnostic-collection')

export default class Collection implements DiagnosticCollection {
  private diagnosticsMap: Map<string, Diagnostic[]> = new Map()
  private _onDispose = new Emitter<void>()
  private _onDidDiagnosticsChange = new Emitter<string>()
  private _onDidDiagnosticsClear = new Emitter<string[]>()

  public readonly name: string
  public readonly onDispose: Event<void> = this._onDispose.event
  public readonly onDidDiagnosticsChange: Event<string> = this._onDidDiagnosticsChange.event
  public readonly onDidDiagnosticsClear: Event<string[]> = this._onDidDiagnosticsClear.event

  constructor(owner: string) {
    this.name = owner
  }

  public set(uri: string, diagnostics: Diagnostic[] | null): void
  public set(entries: [string, Diagnostic[] | null][]): void
  public set(entries: [string, Diagnostic[] | null][] | string, diagnostics?: Diagnostic[]): void {
    if (Array.isArray(entries)) {
      let map: Map<string, Diagnostic[]> = new Map()
      for (let item of entries) {
        let [file, diagnostics] = item
        let exists = map.get(file) || []
        if (diagnostics != null) {
          for (let diagnostic of diagnostics) {
            exists.push(diagnostic)
          }
        } else {
          exists = []
        }
        map.set(file, exists)
      }
      for (let key of map.keys()) {
        this.set(key, map.get(key))
      }
      return
    }
    let uri = entries
    uri = URI.parse(uri).toString()
    if (diagnostics) {
      diagnostics.forEach(o => {
        if (emptyRange(o.range)) {
          o.range.end = {
            line: o.range.end.line,
            character: o.range.end.character + 1
          }
        }
        o.source = o.source || this.name
      })
    }
    this.diagnosticsMap.set(uri, diagnostics || [])
    this._onDidDiagnosticsChange.fire(uri)
    return
  }

  public delete(uri: string): void {
    this.diagnosticsMap.delete(uri)
    this._onDidDiagnosticsChange.fire(uri)
  }

  public clear(): void {
    let uris = Array.from(this.diagnosticsMap.keys())
    this.diagnosticsMap.clear()
    this._onDidDiagnosticsClear.fire(uris)
  }

  public forEach(callback: (uri: string, diagnostics: Diagnostic[], collection: DiagnosticCollection) => any, thisArg?: any): void {
    for (let uri of this.diagnosticsMap.keys()) {
      let diagnostics = this.diagnosticsMap.get(uri)
      callback.call(thisArg, uri, diagnostics, this)
    }
  }

  public get(uri: string): Diagnostic[] {
    let arr = this.diagnosticsMap.get(uri)
    return arr == null ? [] : arr
  }

  public has(uri: string): boolean {
    return this.diagnosticsMap.has(uri)
  }

  public dispose(): void {
    this.clear()
    this._onDispose.fire(void 0)
    this._onDispose.dispose()
    this._onDidDiagnosticsClear.dispose()
    this._onDidDiagnosticsChange.dispose()
  }
}
