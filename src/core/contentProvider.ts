'use strict'
import { Neovim } from '@chemzqm/neovim'
import { URI } from 'vscode-uri'
import events from '../events'
import { TextDocumentContentProvider } from '../provider'
import { disposeAll } from '../util'
import { CancellationTokenSource, Disposable, Emitter, Event } from '../util/protocol'
import { toText } from '../util/string'
import Documents from './documents'

export default class ContentProvider implements Disposable {
  private nvim: Neovim
  private disposables: Disposable[] = []
  private providers: Map<string, TextDocumentContentProvider> = new Map()
  private readonly _onDidProviderChange = new Emitter<void>()
  public readonly onDidProviderChange: Event<void> = this._onDidProviderChange.event
  constructor(
    private documents: Documents
  ) {
  }

  public attach(nvim: Neovim): void {
    this.nvim = nvim
    events.on('BufReadCmd', this.onBufReadCmd, this, this.disposables)
  }

  public get schemes(): string[] {
    return Array.from(this.providers.keys())
  }

  public async onBufReadCmd(scheme: string, uri: string): Promise<void> {
    let provider = this.providers.get(scheme)
    if (!provider) return
    let tokenSource = new CancellationTokenSource()
    let content = await Promise.resolve(provider.provideTextDocumentContent(URI.parse(uri), tokenSource.token))
    let buf = await this.nvim.buffer
    await buf.setLines(toText(content).split(/\r?\n/), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
    process.nextTick(() => {
      void events.fire('BufCreate', [buf.id])
    })
  }

  private resetAutocmds(): void {
    let { nvim, schemes } = this
    nvim.pauseNotification()
    nvim.command(`autocmd! coc_dynamic_content`, true)
    for (let scheme of schemes) {
      nvim.command(getAutocmdCommand(scheme), true)
    }
    nvim.resumeNotification(false, true)
  }

  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    this.providers.set(scheme, provider)
    this._onDidProviderChange.fire()
    let disposables: Disposable[] = []
    if (provider.onDidChange) {
      provider.onDidChange(async uri => {
        let doc = this.documents.getDocument(uri.toString())
        if (!doc) return
        let tokenSource = new CancellationTokenSource()
        let content = await Promise.resolve(provider.provideTextDocumentContent(uri, tokenSource.token))
        await doc.buffer.setLines(content.split(/\r?\n/), {
          start: 0,
          end: -1,
          strictIndexing: false
        })
      }, null, disposables)
    }
    this.nvim.command(getAutocmdCommand(scheme), true)
    return Disposable.create(() => {
      this.providers.delete(scheme)
      disposeAll(disposables)
      this.resetAutocmds()
      this._onDidProviderChange.fire()
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this._onDidProviderChange.dispose()
    this.providers.clear()
  }
}

function getAutocmdCommand(scheme: string): string {
  let rhs = `call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<afile>')]) | filetype detect`
  return `autocmd! coc_dynamic_content BufReadCmd,FileReadCmd,SourceCmd ${scheme}:/* ${rhs}`
}
