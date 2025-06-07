'use strict'
import { URI } from 'vscode-uri'
import events from '../events'
import { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { defaultValue } from '../util'
import { forEach } from '../util/async'
import { isGitIgnored } from '../util/fs'
import { CancellationTokenSource } from '../util/protocol'

export class KeywordsBuffer implements SyncItem {
  private lineWords: ReadonlyArray<string>[] = []
  private _gitIgnored = false
  private tokenSource: CancellationTokenSource | undefined
  private minimalCharacterLen = 2
  constructor(private doc: Document, private segmenterLocales: string) {
    void this.parseWords(segmenterLocales)
    let uri = URI.parse(doc.uri)
    if (uri.scheme === 'file') {
      void isGitIgnored(uri.fsPath).then(ignored => {
        this._gitIgnored = ignored
      })
    }
  }

  public getWords(): string[] {
    let res: string[] = []
    for (let words of this.lineWords) {
      words.forEach(word => {
        if (!res.includes(word)) {
          res.push(word)
        }
      })
    }
    return res
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = undefined
    }
  }

  public async parseWords(segmenterLocales: string | null): Promise<void> {
    let { lineWords, doc, minimalCharacterLen } = this
    let { chars } = doc
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    await forEach(doc.textDocument.lines, line => {
      let words = chars.matchLine(line, segmenterLocales, minimalCharacterLen)
      lineWords.push(words)
    }, token, { yieldAfter: 20 })
  }

  public get bufnr(): number {
    return this.doc.bufnr
  }

  public get gitIgnored(): boolean {
    return this._gitIgnored
  }

  public onCompleteDone(idx: number): void {
    let { doc, segmenterLocales, minimalCharacterLen } = this
    let line = doc.getline(idx)
    this.lineWords[idx] = doc.chars.matchLine(line, segmenterLocales, minimalCharacterLen)
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (events.completing || e.contentChanges.length == 0) return
    let { lineWords, doc, segmenterLocales, minimalCharacterLen } = this
    let { range, text } = e.contentChanges[0]
    let { start, end } = range
    let sl = start.line
    let el = end.line
    let del = el - sl
    let newLines = doc.textDocument.lines.slice(sl, sl + text.split(/\n/).length)
    let arr = newLines.map(line => doc.chars.matchLine(line, segmenterLocales, minimalCharacterLen))
    lineWords.splice(sl, del + 1, ...arr)
  }

  public *matchWords(line: number): Iterable<string> {
    let { lineWords } = this
    if (line >= lineWords.length) line = lineWords.length - 1
    for (let i = 0; i < lineWords.length; i++) {
      let idx = i < line ? line - i - 1 : i
      let words = defaultValue(lineWords[idx], [])
      for (let word of words) {
        yield word
      }
    }
  }

  public dispose(): void {
    this.cancel()
    this.lineWords = []
  }
}
