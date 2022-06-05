'use strict'
import { InsertChange } from '../events'
import Document from '../model/document'
import { CompleteOption, ISource } from '../types'
import { byteSlice } from '../util/string'
import sources from '../sources'
const logger = require('../util/logger')('completion-util')

export function shouldStop(bufnr: number, pretext: string, info: InsertChange, option: Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'colnr'>): boolean {
  let { pre } = info
  if (pre.length === 0 || pre[pre.length - 1] === ' ' || pre.length < pretext.length) return true
  if (option.bufnr != bufnr) return true
  let text = byteSlice(option.line, 0, option.colnr - 1)
  if (option.linenr != info.lnum || !pre.startsWith(text)) return true
  return false
}

export function getInput(document: Document, pre: string, asciiCharactersOnly: boolean): string {
  let len = 0
  for (let i = pre.length - 1; i >= 0; i--) {
    let ch = pre[i]
    let word = document.isWord(ch) && (asciiCharactersOnly ? ch.charCodeAt(0) < 255 : true)
    if (word) {
      len += 1
    } else {
      break
    }
  }
  return len == 0 ? '' : pre.slice(-len)
}

export function getSources(option: CompleteOption): ISource[] {
  let { source } = option
  if (source) {
    let s = sources.getSource(source)
    return s ? [s] : []
  }
  return sources.getCompleteSources(option)
}

export function getPrependWord(document: Document, remain: string): string {
  let idx = 0
  for (let i = 0; i < remain.length; i++) {
    if (document.isWord(remain[i])) {
      idx = i + 1
    } else {
      break
    }
  }
  return idx == 0 ? '' : remain.slice(0, idx)
}
