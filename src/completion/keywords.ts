'use strict'
import { URI } from 'vscode-uri'
import { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { isGitIgnored } from '../util/fs'

export class KeywordsBuffer implements SyncItem {
  private lineWords: ReadonlyArray<string>[] = []
  private _gitIgnored = false
  constructor(private doc: Document) {
    this.parseWords()
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

  public parseWords(): void {
    let { lineWords, doc } = this
    let { chars } = doc
    for (let line of this.doc.textDocument.lines) {
      let words = chars.matchLine(line, 2)
      lineWords.push(words)
    }
  }

  public get bufnr(): number {
    return this.doc.bufnr
  }

  public get gitIgnored(): boolean {
    return this._gitIgnored
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (e.contentChanges.length == 0) return
    let { lineWords, doc } = this
    let { range, text } = e.contentChanges[0]
    let { start, end } = range
    let sl = start.line
    let el = end.line
    let del = el - sl
    let newLines = doc.textDocument.lines.slice(sl, sl + text.split(/\n/).length)
    let arr = newLines.map(line => doc.chars.matchLine(line, 2))
    lineWords.splice(sl, del + 1, ...arr)
  }

  public *matchWords(line: number): Iterable<string> {
    let { lineWords } = this
    if (line >= lineWords.length) line = lineWords.length - 1
    for (let i = 0; i < lineWords.length; i++) {
      let idx = i < line ? line - i - 1 : i
      let words = lineWords[idx]
      for (let word of words) {
        yield word
      }
    }
  }

  public dispose(): void {
    this.lineWords = []
  }
}
