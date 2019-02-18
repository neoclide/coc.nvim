import { Neovim, Window, Buffer } from '@chemzqm/neovim'
import { PumBounding } from '../types'
import { MarkupKind } from 'vscode-languageserver-types'
import { byteLength } from '../util/string'
import { Chars } from '../model/chars'
const logger = require('../util/logger')('floating')

interface Bounding {
  row: number
  col: number
  width: number
  height: number
}

export interface FloatingConfig {
  columns: number
  lines: number
  cmdheight: number
  maxPreviewWidth: number
  srcId: number
}

export default class FloatingWindow {
  private buffer: Buffer
  private window: Window
  private creating = false
  private content: string
  private kind: MarkupKind
  private bounding: PumBounding
  private lines: string[]
  private hasDetail: boolean
  public chars: Chars

  constructor(private nvim: Neovim, private config: FloatingConfig) {
  }

  public async show(content: string, bounding: PumBounding, kind?: MarkupKind, hasDetail = false): Promise<void> {
    this.content = content
    this.bounding = bounding
    this.kind = kind
    this.hasDetail = hasDetail
    if (this.creating) return
    let { nvim } = this
    if (!this.window) {
      this.creating = true
      let b = this.calculateBounding()
      let buf = this.buffer = await nvim.createNewBuffer(false)
      let win = this.window = await nvim.openFloatWindow(buf, false, b.width, b.height, {
        col: b.col,
        row: b.row,
        unfocusable: true,
        standalone: true
      })
      nvim.pauseNotification()
      win.setOption('signcolumn', 'no', true)
      win.setOption('number', false, true)
      win.setOption('relativenumber', false, true)
      win.setOption('winhl', 'Normal:CocPumFloating,NormalNC:CocPumFloating', true)
      this.buffer.setLines(this.lines, { start: 0, end: -1, strictIndexing: false }, true)
      this.setFiletype()
      this.highlight()
      await nvim.resumeNotification()
      this.creating = false
    } else {
      let b = this.calculateBounding()
      nvim.pauseNotification()
      this.window.configFloat(b.width, b.height, {
        col: b.col,
        row: b.row,
        unfocusable: true,
        standalone: true
      }, true)
      this.buffer.setLines(this.lines, { start: 0, end: -1, strictIndexing: false }, true)
      this.setFiletype()
      this.highlight()
      await nvim.resumeNotification()
    }
  }

  private setFiletype(): void {
    let { buffer, kind } = this
    buffer.setOption('filetype', kind == 'markdown' ? 'txt' : 'txt', true)
  }

  private highlight(): void {
    let { buffer, hasDetail, lines } = this
    let srcId = this.config.srcId || 990
    buffer.clearNamespace(srcId)
    if (!hasDetail) return
    let i = 0
    for (let line of lines) {
      if (!line.length) break
      buffer.addHighlight({
        srcId,
        hlGroup: 'CocPumFloatingDetail',
        line: i,
        colStart: 0,
        colEnd: -1
      })
      i = i + 1
    }
  }

  private calculateBounding(): Bounding {
    let { content, bounding, config } = this
    let { columns, lines, maxPreviewWidth } = config
    let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0)
    let showRight = true
    let delta = columns - bounding.col - pumWidth
    if (delta < maxPreviewWidth && bounding.col > maxPreviewWidth) {
      // show left
      showRight = false
    }
    let maxWidth = !showRight || delta > maxPreviewWidth ? maxPreviewWidth : delta
    let arr = content.replace(/\t/g, ' ').split('\n')
    let newLines: string[] = []
    for (let str of arr) {
      let len = byteLength(str)
      if (len > maxWidth - 2) {
        // don't split on word
        newLines.push(...this.softSplit(str, maxWidth - 2))
      } else {
        newLines.push(str)
      }
    }
    let maxHeight = lines - bounding.row - this.config.cmdheight - 1
    this.lines = newLines.map(s => s.length ? ' ' + s : '')
    let width = Math.min(maxWidth, Math.max(...this.lines.map(s => byteLength(s) + 1)))

    return {
      col: showRight ? bounding.col + pumWidth : bounding.col - width,
      row: bounding.row,
      height: Math.min(maxHeight, newLines.length),
      width
    }
  }

  private softSplit(line: string, maxWidth: number): string[] {
    // let buf = global.Buffer.from(line, 'utf8')
    let res: string[] = []
    let chars = this.chars
    let finished = false
    let start = 0
    do {
      let len = 0
      let lastNonKeyword = 0
      for (let i = start; i < line.length; i++) {
        let ch = line[i]
        let code = ch.charCodeAt(0)
        let iskeyword = code < 255 && chars.isKeywordCode(code)
        if (len >= maxWidth) {
          if (iskeyword && lastNonKeyword) {
            res.push(line.slice(start, lastNonKeyword + 1).replace(/\s+$/, ''))
            start = lastNonKeyword + 1
          } else {
            let end = len == maxWidth ? i : i - 1
            res.push(line.slice(start, end).replace(/\s+$/, ''))
            start = end
          }
          break
        }
        len = len + byteLength(ch)
        if (!iskeyword) lastNonKeyword = i
        if (i == line.length - 1) {
          let content = line.slice(start, i + 1).replace(/\s+$/, '')
          if (content.length) res.push(content)
          finished = true
        }
      }
    } while (!finished)
    return res
  }

  public close(): void {
    let { nvim } = this
    if (!this.buffer) return
    let id = this.buffer.id
    this.buffer = null
    this.window = null
    let times = 0
    let interval = setInterval(async () => {
      times = times + 1
      await nvim.command(`silent! bdelete! ${id}`)
      let loaded = await nvim.call('bufloaded', [id])
      if (!loaded && times == 5) clearInterval(interval)
    }, 100)
  }
}
