import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource } from 'vscode-jsonrpc'
import { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { isGitIgnored } from '../util/fs'
import events from '../events'
import { URI } from 'vscode-uri'

export default class KeywordsBuffer implements SyncItem {
  private _words: Set<string> = new Set()
  private _gitIgnored = false
  private version: number
  private tokenSource: CancellationTokenSource
  constructor(private doc: Document, private nvim: Neovim) {
    this.parse()
    let uri = URI.parse(doc.uri)
    if (uri.scheme === 'file') {
      void isGitIgnored(uri.fsPath).then(ignored => {
        this._gitIgnored = ignored
      })
    }
  }

  public get bufnr(): number {
    return this.doc.bufnr
  }

  public get gitIgnored(): boolean {
    return this._gitIgnored
  }

  public get words(): Set<string> {
    return this._words
  }

  private parse(): void {
    this.cancel()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    if (events.pumvisible) return
    this.version = this.doc.version
    void this.doc.matchWords(tokenSource.token).then(res => {
      if (res != null) this._words = res
    })
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public onChange(): void {
    this.parse()
  }

  public onTextChange(): void {
    if (this.version !== this.doc.version) {
      this.parse()
    }
  }

  public dispose(): void {
    this.cancel()
    this._words.clear()
  }
}
