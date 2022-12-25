'use strict'
import { DocumentSymbol } from 'vscode-languageserver-types'
import languages from '../../languages'
import { createLogger } from '../../logger'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { DidChangeTextDocumentParams } from '../../types'
import { disposeAll, getConditionValue } from '../../util'
import { debounce } from '../../util/node'
import { CancellationTokenSource, Disposable, Emitter, Event } from '../../util/protocol'
import { handleError } from '../util'
const logger = createLogger('symbols-buffer')

const DEBEBOUNCE_INTERVAL = getConditionValue(500, 10)

export default class SymbolsBuffer implements SyncItem {
  private disposables: Disposable[] = []
  public fetchSymbols: (() => void) & { clear(): void }
  private version: number
  public symbols: DocumentSymbol[]
  private tokenSource: CancellationTokenSource
  private readonly _onDidUpdate = new Emitter<DocumentSymbol[]>()
  public readonly onDidUpdate: Event<DocumentSymbol[]> = this._onDidUpdate.event
  constructor(public readonly doc: Document, private autoUpdateBufnrs: Set<number>) {
    this.fetchSymbols = debounce(() => {
      this._fetchSymbols().catch(handleError)
    }, DEBEBOUNCE_INTERVAL)
  }

  /**
   * Enable autoUpdate when invoked.
   */
  public async getSymbols(): Promise<DocumentSymbol[]> {
    let { doc } = this
    await doc.patchChange()
    this.autoUpdateBufnrs.add(doc.bufnr)
    // refresh for empty symbols since some languages server could be buggy first time.
    if (doc.version == this.version && this.symbols?.length) return this.symbols
    this.cancel()
    await this._fetchSymbols()
    return this.symbols
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (e.contentChanges.length === 0) return
    this.cancel()
    if (this.autoUpdateBufnrs.has(this.doc.bufnr)) {
      this.fetchSymbols()
    }
  }

  private async _fetchSymbols(): Promise<void> {
    let { textDocument } = this.doc
    let { version } = textDocument
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let { token } = tokenSource
    let symbols = await languages.getDocumentSymbol(textDocument, token)
    this.tokenSource = undefined
    if (symbols == null || token.isCancellationRequested) return
    this.version = version
    this.symbols = symbols
    this._onDidUpdate.fire(symbols)
  }

  public cancel(): void {
    this.fetchSymbols.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.cancel()
    this.symbols = undefined
    this._onDidUpdate.dispose()
    disposeAll(this.disposables)
  }
}
