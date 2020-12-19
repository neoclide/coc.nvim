import { Disposable } from 'vscode-languageserver-protocol'
import { DidChangeTextDocumentParams } from '../types'
import Document from './document'

export interface SyncItem extends Disposable {
  onChange?(e: DidChangeTextDocumentParams): void
}

/**
 * Buffer sync support, document is always attached and now command line buffer.
 */
export default class BufferSync<T extends SyncItem> {
  private itemsMap: Map<number, SyncItem> = new Map()
  constructor(private _create: (doc: Document) => T) {
  }

  public create(doc: Document): void {
    if (!doc || doc.isCommandLine || !doc.attached) return
    let item = this._create(doc)
    this.itemsMap.set(doc.bufnr, item)
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    let item = this.itemsMap.get(e.bufnr)
    if (item && typeof item.onChange == 'function') {
      item.onChange(e)
    }
  }

  public delete(bufnr: number): void {
    let item = this.itemsMap.get(bufnr)
    if (item) {
      this.itemsMap.delete(bufnr)
      item.dispose()
    }
  }

  public dispose(): void {
    for (let item of this.itemsMap.values()) {
      item.dispose()
    }
    this.itemsMap.clear()
  }
}
