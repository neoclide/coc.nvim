import { byteLength } from '../util/string'
import { Buffer, Neovim } from '@chemzqm/neovim'

interface HighlightItem {
  // all zero indexed
  lnum: number
  colStart: number
  // default to -1
  colEnd?: number
  hlGroup: string
}

/**
 * Build highlights, with lines and highlights
 */
export default class Highlighter {
  private lines: string[] = []
  private highlights: HighlightItem[] = []

  constructor(private srcId = -1) {
  }

  public addLine(line: string, hlGroup?: string): void {
    if (line.indexOf('\n') !== -1) {
      for (let content of line.split(/\r?\n/)) {
        this.addLine(content, hlGroup)
      }
      return
    }
    if (hlGroup) {
      this.highlights.push({
        lnum: this.lines.length,
        colStart: line.match(/^\s*/)[0].length,
        colEnd: byteLength(line),
        hlGroup
      })
    }
    this.lines.push(line)
  }

  public addText(text: string, hlGroup?: string): void {
    let { lines } = this
    let pre = lines[lines.length - 1] || ''
    if (hlGroup) {
      let colStart = byteLength(pre)
      this.highlights.push({
        lnum: lines.length ? lines.length - 1 : 0,
        colStart,
        colEnd: colStart + byteLength(text),
        hlGroup
      })
    }
    if (lines.length) {
      lines[lines.length - 1] = `${pre}${text}`
    } else {
      lines.push(text)
    }
  }

  public get length(): number {
    return this.lines.length
  }

  // default to replace
  public render(buffer: Buffer, start = 0, end = -1): void {
    buffer.setLines(this.lines, { start, end, strictIndexing: false })
    for (let item of this.highlights) {
      buffer.addHighlight({
        hlGroup: item.hlGroup,
        colStart: item.colStart,
        colEnd: item.colEnd,
        line: start + item.lnum,
        srcId: this.srcId
      }).catch(_e => {
        // noop
      })
    }
  }
}
