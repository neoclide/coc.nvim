import debounce from 'debounce'
import { CancellationTokenSource, Disposable, DocumentSymbol, Emitter, Event, SymbolTag, TextDocument } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { isDocumentSymbols } from './util'

export default class SymbolsBuffer implements SyncItem {
  private disposables: Disposable[] = []
  public fetchSymbols: (() => void) & { clear(): void }
  private autoUpdate = false
  private version: number
  private symbols: DocumentSymbol[]
  private tokenSource: CancellationTokenSource
  private readonly _onDidUpdate = new Emitter<DocumentSymbol[]>()
  public readonly onDidUpdate: Event<DocumentSymbol[]> = this._onDidUpdate.event
  constructor(public readonly bufnr: number) {
    this.fetchSymbols = debounce(() => {
      this._fetchSymbols().logError()
    }, global.hasOwnProperty('__TEST__') ? 10 : 500)
  }

  /**
   * Enable autoUpdate when invoked.
   */
  public async getSymbols(): Promise<DocumentSymbol[]> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return []
    await doc.patchChange()
    this.autoUpdate = true
    // refresh for empty symbols since some languages server could be buggy first time.
    if (doc.version == this.version && this.symbols?.length) return this.symbols
    this.cancel()
    await this._fetchSymbols()
    return this.symbols
  }

  public onChange(): void {
    this.cancel()
    if (this.autoUpdate) {
      this.fetchSymbols()
    }
  }

  private get textDocument(): TextDocument | undefined {
    return workspace.getDocument(this.bufnr)?.textDocument
  }

  private async _fetchSymbols(): Promise<void> {
    let { textDocument } = this
    if (!textDocument) return
    let { version } = textDocument
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let { token } = tokenSource
    let symbols = await languages.getDocumentSymbol(textDocument, token)
    this.tokenSource = undefined
    if (symbols == null || token.isCancellationRequested) return
    let res: DocumentSymbol[]
    if (isDocumentSymbols(symbols)) {
      res = symbols
    } else {
      res = symbols.map(o => {
        let sym = DocumentSymbol.create(o.name, '', o.kind, o.location.range, o.location.range)
        if (o.deprecated) sym.tags = [SymbolTag.Deprecated]
        return sym
      })
    }
    this.version = version
    this.symbols = res
    this._onDidUpdate.fire(res)
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
