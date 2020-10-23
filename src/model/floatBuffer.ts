import { Neovim } from '@chemzqm/neovim'
import { Documentation, Fragment } from '../types'
import { group } from '../util/array'
import { getHiglights, Highlight, diagnosticFiletypes } from '../util/highlight'
import { byteLength, characterIndex } from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('model-floatBuffer')

export interface Dimension {
  width: number
  height: number
}

export default class FloatBuffer {
  private lines: string[] = []
  private highlights: Highlight[]
  private positions: [number, number, number?][] = []
  private enableHighlight = true
  private highlightTimeout = 500
  private filetype: string
  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences')
    this.enableHighlight = config.get<boolean>('enableFloatHighlight', true)
    this.highlightTimeout = config.get<number>('highlightTimeout', 500)
  }

  public async setDocuments(docs: Documentation[], width: number): Promise<void> {
    let fragments = this.calculateFragments(docs, width)
    let { filetype } = docs[0]
    if (!diagnosticFiletypes.includes(filetype)) {
      this.filetype = filetype
    }
    if (workspace.isNvim) {
      fragments = fragments.reduce((p, c) => {
        p.push(...this.splitFragment(c, 'sh'))
        return p
      }, [])
    }
    if (this.enableHighlight) {
      let arr = await Promise.all(fragments.map(f => getHiglights(f.lines, f.filetype, this.highlightTimeout).then(highlights => highlights.map(highlight => Object.assign({}, highlight, { line: highlight.line + f.start })))))
      this.highlights = arr.reduce((p, c) => p.concat(c), [])
    } else {
      this.highlights = []
    }
  }

  public splitFragment(fragment: Fragment, defaultFileType: string): Fragment[] {
    let res: Fragment[] = []
    let filetype = fragment.filetype
    let lines: string[] = []
    let curr = fragment.start
    let inBlock = false
    for (let line of fragment.lines) {
      let ms = line.match(/^\s*```\s*(\w+)?/)
      if (ms != null) {
        if (lines.length) {
          res.push({ lines, filetype: fixFiletype(filetype), start: curr - lines.length })
          lines = []
        }
        inBlock = !inBlock
        filetype = inBlock ? ms[1] || defaultFileType : fragment.filetype
      } else {
        lines.push(line)
        curr = curr + 1
      }
    }
    if (lines.length) {
      res.push({ lines, filetype: fixFiletype(filetype), start: curr - lines.length })
      lines = []
    }
    return res
  }

  public setLines(bufnr: number, winid?: number): void {
    let { lines, nvim, highlights } = this
    let buffer = nvim.createBuffer(bufnr)
    nvim.call('clearmatches', winid ? [winid] : [], true)
    // vim will clear text properties
    if (workspace.isNvim) buffer.clearNamespace(-1, 0, -1)
    if (workspace.isNvim) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    } else {
      nvim.call('coc#util#set_buf_lines', [bufnr, lines], true)
    }
    if (highlights && highlights.length) {
      let positions: [number, number, number?][] = []
      for (let highlight of highlights) {
        if (highlight.hlGroup == 'htmlBold') {
          highlight.hlGroup = 'CocBold'
        }
        buffer.addHighlight({
          srcId: workspace.createNameSpace('coc-float'),
          ...highlight
        }).logError()
        if (highlight.isMarkdown) {
          let line = lines[highlight.line]
          if (line) {
            let si = characterIndex(line, highlight.colStart)
            let ei = characterIndex(line, highlight.colEnd) - 1
            let before = line[si]
            let after = line[ei]
            if (before == after && ['_', '`', '*'].includes(before)) {
              if (before == '_' && line[si + 1] == '_' && line[ei - 1] == '_' && si + 1 < ei - 1) {
                positions.push([highlight.line + 1, highlight.colStart + 1, 2])
                positions.push([highlight.line + 1, highlight.colEnd - 1, 2])
              } else {
                positions.push([highlight.line + 1, highlight.colStart + 1])
                positions.push([highlight.line + 1, highlight.colEnd])
              }
            }
            if (highlight.colEnd - highlight.colStart == 2 && before == '\\') {
              positions.push([highlight.line + 1, highlight.colStart + 1])
            }
          }
        }
      }
      for (let arr of group(positions, 8)) {
        if (winid) {
          nvim.call('win_execute', [winid, `call matchaddpos('Conceal', ${JSON.stringify(arr)},11)`], true)
        } else {
          nvim.call('matchaddpos', ['Conceal', arr, 11], true)
        }
      }
    }
    for (let arr of group(this.positions || [], 8)) {
      arr = arr.filter(o => o[2] != 0)
      if (arr.length) {
        if (winid) {
          nvim.call('win_execute', [winid, `call matchaddpos('CocUnderline', ${JSON.stringify(arr)},12)`], true)
        } else {
          nvim.call('matchaddpos', ['CocUnderline', arr, 12], true)
        }
      }
    }
    if (winid && this.enableHighlight && this.filetype) {
      nvim.call('win_execute', [winid, `runtime! syntax/${this.filetype}.vim`], true)
    }
  }

  private calculateFragments(docs: Documentation[], width: number): Fragment[] {
    let fragments: Fragment[] = []
    let idx = 0
    let currLine = 0
    let newLines: string[] = []
    let positions = this.positions = []
    for (let doc of docs) {
      let lines: string[] = []
      let arr = doc.content.split(/\r?\n/)
      for (let str of arr) {
        if (doc.filetype == 'markdown') {
          // replace `\` surrounded by `__` because bug of markdown highlight in vim.
          str = str.replace(/__(.+?)__/g, (_, p1) => {
            return `__${p1.replace(/\\_/g, '_').replace(/\\\\/g, '\\')}__`
          })
        }
        lines.push(str)
        if (doc.active) {
          let part = str.slice(doc.active[0], doc.active[1])
          positions.push([currLine + 1, doc.active[0] + 1, byteLength(part)])
        }
      }
      fragments.push({
        start: currLine,
        lines,
        filetype: doc.filetype
      })
      let filtered = workspace.isNvim && doc.filetype === 'markdown' ? lines.filter(s => !/^\s*```/.test(s)) : lines
      newLines.push(...filtered)
      if (idx != docs.length - 1) {
        newLines.push('—'.repeat(width - 2))
        currLine = newLines.length
      }
      idx = idx + 1
    }
    this.lines = newLines
    return fragments
  }

  // return lines for calculate dimension
  // TODO need use parsed lines for markdown
  public static getLines(docs: Documentation[], isNvim: boolean): string[] {
    let res: string[] = []
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i]
      let lines = doc.content.split(/\r?\n/)
      for (let line of lines) {
        if (isNvim && doc.filetype == 'markdown' && /^\s*```/.test(line)) {
          continue
        }
        res.push(line)
      }
      if (i != docs.length - 1) {
        res.push('-')
      }
    }
    return res
  }

  public static getDimension(docs: Documentation[], maxWidth: number, maxHeight: number): Dimension {
    // width contains padding
    if (maxWidth <= 2 || maxHeight <= 0) return { width: 0, height: 0 }
    let arr: number[] = []
    for (let doc of docs) {
      let lines = doc.content.split(/\r?\n/)
      for (let line of lines) {
        if (workspace.isNvim && doc.filetype == 'markdown' && /^\s*```/.test(line)) {
          continue
        }
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

function fixFiletype(filetype: string): string {
  if (filetype == 'ts') return 'typescript'
  if (filetype == 'js') return 'javascript'
  if (filetype == 'bash') return 'sh'
  return filetype
}
