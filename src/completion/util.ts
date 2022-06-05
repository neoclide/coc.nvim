'use strict'
import { InsertChange } from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteOption, ISource } from '../types'
import { byteSlice } from '../util/string'
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

export function shouldIndent(indentkeys = '', pretext: string): boolean {
  if (!indentkeys || pretext.trim().includes(' ')) return false
  for (let part of indentkeys.split(',')) {
    if (part.indexOf('=') > -1) {
      let [pre, post] = part.split('=')
      let word = post.startsWith('~') ? post.slice(1) : post
      if (pretext.length < word.length ||
        (pretext.length > word.length && !/^\s/.test(pretext.slice(-word.length - 1)))) {
        continue
      }
      let matched = post.startsWith('~') ? pretext.toLowerCase().endsWith(word) : pretext.endsWith(word)
      if (!matched) {
        continue
      }
      if (pre == '') {
        return true
      }
      if (pre == '0' && (pretext.length == word.length || /^\s*$/.test(pretext.slice(0, pretext.length - word.length)))) {
        return true
      }
    }
  }
  return false
}
