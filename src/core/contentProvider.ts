import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { TextDocumentContentProvider } from '../provider'
import { disposeAll } from '../util'

export default class ContentProvider {
  private providers: Map<string, TextDocumentContentProvider> = new Map()
  private readonly _onDidProviderChange = new Emitter<void>()
  public readonly onDidProviderChange: Event<void> = this._onDidProviderChange.event
  constructor(nvim: Neovim) {

  }

  public get schemes():string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * registerTextDocumentContentProvider
   */
  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    this.providers.set(scheme, provider)
    this._onDidProviderChange.fire()
    let disposables: Disposable[] = []
    if (provider.onDidChange) {
      provider.onDidChange(async uri => {
        let doc = this.getDocument(uri.toString())
        if (doc) {
          let { buffer } = doc
          let tokenSource = new CancellationTokenSource()
          let content = await Promise.resolve(provider.provideTextDocumentContent(uri, tokenSource.token))
          await buffer.setLines(content.split(/\r?\n/), {
            start: 0,
            end: -1,
            strictIndexing: false
          })
        }
      }, null, disposables)
    }
    return Disposable.create(() => {
      this.providers.delete(scheme)
      disposeAll(disposables)
      this._onDidProviderChange.fire()
    })
  }
}
