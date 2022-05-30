'use strict'
import { InsertChange } from '../events'
import { CompleteOption } from '../types'
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
