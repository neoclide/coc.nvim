import { Neovim } from '@chemzqm/neovim'
import { Documentation } from '../types'
import { byteLength } from '../util/string'
const logger = require('../util/logger')('model-floatBuffer')

export const diagnosticFiletypes = ['Error', 'Warning', 'Info', 'Hint']

export interface HighlightItem {
  startLine: number
  endLine: number
  filetype?: string
  hlGroup?: string
}

export interface Dimension {
  width: number
  height: number
}

export default class FloatBuffer {
  private lines: string[] = []
  private highlights: HighlightItem[]
  constructor(private nvim: Neovim, private isVim: boolean) {
  }

  public setDocuments(docs: Documentation[], width: number): void {
    let lines: string[] = this.lines = []
    let highlights: HighlightItem[] = this.highlights = []
    for (let i = 0; i < docs.length; i++) {
      let { filetype, content } = docs[i]
      let startLine = lines.length + 1
      let arr = content.split(/\r?\n/)
      lines.push(...arr)
      if (diagnosticFiletypes.includes(filetype)) {
        highlights.push({ startLine, endLine: startLine + arr.length, hlGroup: `Coc${filetype}Float` })
      } else {
        highlights.push({ startLine, endLine: startLine + arr.length, filetype })
      }
      if (i != docs.length - 1) {
        lines.push('—'.repeat(width))
      }
    }
  }

  public setLines(bufnr: number, winid: number, highlight = true): void {
    if (winid === undefined) {
      throw new Error("FloatBuffer.setLines api have changed, but some extension still using old API!")
    }
    let { lines, nvim, highlights } = this
    let buffer = nvim.createBuffer(bufnr)
    nvim.call('coc#highlight#syntax_clear', [winid], true)
    // vim will clear text properties
    buffer.clearNamespace(-1, 0, -1)
    if (this.isVim) {
      nvim.call('coc#util#set_buf_lines', [bufnr, lines], true)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    }
    if (highlight) {
      if (highlights && highlights.length) {
        nvim.call('coc#highlight#highlight_lines', [winid, highlights], true)
      }
    }
  }

  public static getDimension(docs: Documentation[], maxWidth: number, maxHeight: number): Dimension {
    // width contains padding
    if (maxWidth <= 2 || maxHeight <= 0) return { width: 0, height: 0 }
    let arr: number[] = []
    for (let doc of docs) {
      let lines = doc.content.split(/\r?\n/)
      for (let line of lines) {
        arr.push(byteLength(line.replace(/\t/g, '  ')) + 2)
      }
    }
    let width = Math.min(Math.max(...arr), maxWidth)
    if (width <= 2) return { width: 0, height: 0 }
    let height = docs.length - 1
    for (let w of arr) {
      height = height + Math.max(Math.ceil((w - 2) / (width - 2)), 1)
    }
    return { width, height: Math.min(height, maxHeight) }
  }
}
