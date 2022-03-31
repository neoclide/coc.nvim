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
  private lineCount: number
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

  public parse(): void {
    let lineCount = this.doc.textDocument.lineCount
    let version = this.doc.version
    if (version == this.version
      || (events.insertMode && this.lineCount == lineCount && !global.__TEST__)) return
    this.cancel()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    void this.doc.matchWords(tokenSource.token).then(res => {
      if (res != null) {
        this._words = res
        this.lineCount = lineCount
        this.version = version
      }
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

  public dispose(): void {
    this.cancel()
    this._words.clear()
  }
}
