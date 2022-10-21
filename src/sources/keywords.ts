'use strict'
import unidecode from 'unidecode'
import { URI } from 'vscode-uri'
import { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { isGitIgnored } from '../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes, wordChar } from '../util/fuzzy'
const logger = require('../util/logger')('sources-keywords')
const WORD_PREFIXES = ['_', '$']

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

  public get words(): Set<string> {
    return new Set()
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

  public *matchWords(line: number, input: string, firstMatch: boolean): Iterable<string> {
    let first = input[0]
    let ascii = wordChar(input.charCodeAt(0))
    let len = input.length
    let codes = getCharCodes(input)
    let results: string[] = []
    let { lineWords } = this
    if (line >= lineWords.length) line = lineWords.length - 1
    for (let i = 0; i < lineWords.length; i++) {
      let idx = i < line ? line - i - 1 : i
      let words = lineWords[idx]
      for (let word of words ?? []) {
        let ch = word[0]
        if (ascii && WORD_PREFIXES.includes(ch)) ch = word[1]
        if (firstMatch && !fuzzyChar(first, ascii ? unidecode(ch) : ch)) continue
        if (results.includes(word) || (len > 1 && !fuzzyMatch(codes, ascii ? unidecode(word) : word))) continue
        results.push(word)
        yield word
      }
    }
  }

  public dispose(): void {
    this.lineWords = undefined
  }
}
