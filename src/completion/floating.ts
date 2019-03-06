import { Neovim, Window, Buffer } from '@chemzqm/neovim'
import { PumBounding } from '../types'
import workspace from '../workspace'
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
  srcId: number
  maxPreviewWidth: number
  chars: Chars
}

export default class FloatingWindow {
  private window: Window
  private creating = false
  private content: string
  private kind: MarkupKind
  private bounding: PumBounding
  private lines: string[]
  private hasDetail: boolean

  constructor(private nvim: Neovim,
    private buffer: Buffer,
    private config: FloatingConfig) {
  }

  public async show(content: string, bounding: PumBounding, kind?: MarkupKind, hasDetail = false): Promise<void> {
    this.content = content
    this.bounding = bounding
    this.kind = kind
    this.hasDetail = hasDetail
    if (this.creating) return
    let { nvim } = this
    if (this.window) {
      let valid = await this.window.valid
      if (!valid) this.window = null
    }
    if (!this.window) {
      this.creating = true
      try {
        let b = this.calculateBounding()
        let win = this.window = await nvim.openFloatWindow(this.buffer, false, b.width, b.height, {
          col: b.col,
          row: b.row,
          relative: 'editor'
        })
        nvim.pauseNotification()
        win.setVar('popup', 1, true)
        win.setOption('list', false, true)
        win.setOption('number', false, true)
        win.setOption('cursorline', false, true)
        win.setOption('cursorcolumn', false, true)
        win.setOption('signcolumn', 'no', true)
        win.setOption('conceallevel', 2, true)
        win.setOption('relativenumber', false, true)
        win.setOption('winhl', 'Normal:CocPumFloating,NormalNC:CocPumFloating', true)
        this.configBuffer()
        await nvim.resumeNotification()
      } catch (e) {
        logger.error(`Create preview error:`, e.stack)
      } finally {
        this.creating = false
      }
    } else {
      let b = this.calculateBounding()
      nvim.pauseNotification()
      this.window.configFloat(b.width, b.height, {
        col: b.col,
        row: b.row,
        relative: 'editor'
      }, true)
      this.configBuffer()
      await nvim.resumeNotification()
    }
  }

  private configBuffer(): void {
    let { buffer, window, hasDetail, lines } = this
    window.notify('nvim_win_set_cursor', [window, [1, 1]])
    buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    if (this.kind == 'markdown') {
      // TODO how to render markdown?
    }
    let srcId = this.config.srcId || 990
    buffer.clearNamespace(srcId)
    if (hasDetail) {
      let i = 0
      for (let line of lines) {
        if (!line.trim().length) break
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
  }

  private calculateBounding(): Bounding {
    let { content, bounding, config } = this
    let { columns, lines } = workspace.env
    let { maxPreviewWidth } = config
    let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0)
    let showRight = true
    let delta = columns - bounding.col - pumWidth
    if (delta < maxPreviewWidth && bounding.col > maxPreviewWidth) {
      // show left
      showRight = false
    }
    let maxWidth = !showRight || delta > maxPreviewWidth ? maxPreviewWidth : delta
    let arr = content.replace(/\t/g, '  ').split('\n')
    // join the lines when necessary
    arr = arr.reduce((list, curr) => {
      if (list.length && curr) {
        let pre = list[list.length - 1]
        if (!isSingleLine(pre) && !isBreakCharacter(curr[0])) {
          list[list.length - 1] = pre + ' ' + curr
          return list
        }
      }
      list.push(curr)
      return list
    }, [])

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
    let maxHeight = lines - bounding.row - workspace.env.cmdheight - 1
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
    let chars = this.config.chars
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
}

function isSingleLine(line: string): boolean {
  if (line.trim().length == 0) return true
  if (/^\s*$/.test(line)) return true
  if (/^\s*(-|\*)\s/.test(line)) return true
  if (line.startsWith('#')) return true
  return false
}

function isBreakCharacter(ch: string): boolean {
  let code = ch.charCodeAt(0)
  if (code > 255) return false
  if (code >= 48 && code <= 57) return false
  if (code >= 97 && code <= 122) return false
  if (code >= 65 && code <= 90) return false
  return true
}
