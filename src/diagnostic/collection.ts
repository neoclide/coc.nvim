import { Diagnostic, Emitter, Event, Range } from 'vscode-languageserver-protocol'
import { DiagnosticCollection } from '../types'
import { URI } from 'vscode-uri'
import { emptyRange } from '../util/position'
import workspace from '../workspace'
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
    let diagnosticsPerFile: Map<string, Diagnostic[]> = new Map()
    if (!Array.isArray(entries)) {
      let doc = workspace.getDocument(entries)
      let uri = doc ? doc.uri : entries
      diagnosticsPerFile.set(uri, diagnostics)
    } else {
      for (let item of entries) {
        let [uri, diagnostics] = item
        let doc = workspace.getDocument(uri)
        uri = doc ? doc.uri : uri
        if (diagnostics === undefined) {
          // clear diagnostics if entry contains null
          diagnostics = []
        } else {
          diagnostics = (diagnosticsPerFile.get(uri) || []).concat(diagnostics)
        }

        diagnosticsPerFile.set(uri, diagnostics)
      }
    }
    for (let item of diagnosticsPerFile) {
      let [uri, diagnostics] = item
      uri = URI.parse(uri).toString()
      diagnostics?.forEach(o => {
        o.range = o.range || Range.create(0, 0, 1, 0)
        o.message = o.message || 'Empty error message'
        if (emptyRange(o.range)) {
          o.range.end = {
            line: o.range.end.line,
            character: o.range.end.character + 1
          }
        }
        let { start, end } = o.range
        // fix empty diagnostic at the and of line
        if (end.character == 0 && end.line - start.line == 1 && start.character > 0) {
          // add last character when start character is end
          let doc = workspace.getDocument(uri)
          if (doc) {
            let line = doc.getline(start.line)
            if (start.character == line.length) {
              o.range.start.character = start.character - 1
            }
          }
        }
        o.source = o.source || this.name
      })
      this.diagnosticsMap.set(uri, diagnostics)
      this._onDidDiagnosticsChange.fire(uri)
    }
    return
  }

  public delete(uri: string): void {
    this.diagnosticsMap.delete(uri)
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
