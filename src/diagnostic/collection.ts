import {
  Diagnostic,
} from 'vscode-languageserver-protocol'
import {
  DiagnosticCollection
} from '../types'
import diagnosticManager from './manager'

export default class Collection implements DiagnosticCollection {
  public readonly name: string
  private diagnosticsMap:Map<string, Diagnostic[]> = new Map()

  constructor(owner:string) {
    this.name = owner
  }

  public set(uri: string, diagnostics: Diagnostic[] | null):void
  public set(entries: [string, Diagnostic[] | null][] | string, diagnostics?: Diagnostic[]):void {
    if (Array.isArray(entries)) {
      let map:Map<string, Diagnostic[]> = new Map()
      for (let item of entries) {
        let [file, diagnostics] = item
        let exists = map.get(file) || []
        for (let diagnoctic of diagnostics) {
          diagnoctic.source = diagnoctic.source || this.name
          exists.push(diagnoctic)
        }
        map.set(file, exists)
      }
      for (let key of map.keys()) {
        this.set(key, map.get(key))
      }
      return
    }
    let uri = entries
    this.diagnosticsMap.set(uri, diagnostics)
    diagnosticManager.add(this.name, uri, diagnostics || [])
    return
  }

  public delete(uri: string):void {
    this.diagnosticsMap.set(uri, [])
    diagnosticManager.clear(this.name, uri)
  }

  public clear(): void {
    for (let uri of this.diagnosticsMap.keys()) {
      this.delete(uri)
    }
  }
  public forEach(callback: (uri: string, diagnostics: Diagnostic[], collection: DiagnosticCollection) => any, thisArg?: any): void {
    for (let uri of this.diagnosticsMap.keys()) {
      let diagnostics = this.diagnosticsMap.get(uri)
      callback.call(thisArg, uri, diagnostics, this)
    }
  }

  public get(uri: string): Diagnostic[] | null {
    return this.diagnosticsMap.get(uri)
  }

  public has(uri: string): boolean {
    let diagnostics = this.diagnosticsMap.get(uri)
    return diagnostics && diagnostics.length > 0
  }

  public dispose(): void {
    this.clear()
    diagnosticManager.removeCollection(this.name)
  }
}
