'use strict'
import { URI } from 'vscode-uri'
import { SyncItem } from '../model/bufferSync'
import { Chars } from '../model/chars'
import Document from '../model/document'
import { DidChangeTextDocumentParams } from '../types'
import { isGitIgnored } from '../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes, wordChar } from '../util/fuzzy'
import unidecode from 'unidecode'
const logger = require('../util/logger')('sources-keywords')
const WORD_PREFIXES = ['_', '$']

export function matchLine(line: string, chars: Chars, min = 2): string[] {
  let res: string[] = []
  let l = line.length
  if (l > 1024) {
    line = line.slice(0, 1024)
    l = 1024
  }
  let start = -1
  const add = (end: number) => {
    if (end - start < min) return
    let word = line.slice(start, end)
    if (!res.includes(word)) res.push(word)
  }
  for (let i = 0, l = line.length; i < l; i++) {
    if (chars.isKeywordChar(line[i])) {
      if (start == -1) {
        start = i
      }
    } else {
      if (start != -1) {
        add(i)
        start = -1
      }
    }
    if (i === l - 1 && start != -1) {
      add(l)
    }
  }
  return res
}

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
      let words = matchLine(line, chars)
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
    let sl = range.start.line
    let el = range.end.line
    let n = el - sl
    let add = n == 0 ? 0 : 1
    let nc = text.split(/\n/).length - n + add
    let newLines = doc.textDocument.lines.slice(sl, sl + nc)
    let arr = newLines.map(line => matchLine(line, doc.chars))
    lineWords.splice(sl, n + 1, ...arr)
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
