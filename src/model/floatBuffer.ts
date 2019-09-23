import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { Highlight, getHiglights } from '../util/highlight'
import { characterIndex, byteLength } from '../util/string'
import { group } from '../util/array'
import { Documentation, Fragment } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('model-floatBuffer')

export default class FloatBuffer {
  private lines: string[] = []
  private highlights: Highlight[]
  private positions: [number, number, number?][] = []
  private enableHighlight = true
  private tabstop = 2
  public width = 0
  constructor(
    private nvim: Neovim,
    public buffer: Buffer,
    private window?: Window
  ) {
    let config = workspace.getConfiguration('coc.preferences')
    this.enableHighlight = config.get<boolean>('enableFloatHighlight', true)
    buffer.getOption('tabstop').then(val => {
      this.tabstop = val as number
    }, _e => {
      // noop
    })
  }

  public getHeight(docs: Documentation[], maxWidth: number): number {
    let l = 0
    for (let doc of docs) {
      let lines = doc.content.split(/\r?\n/)
      if (doc.filetype == 'markdown') {
        lines = lines.filter(s => !s.startsWith('```'))
      }
      for (let line of lines) {
        l = l + Math.max(1, Math.ceil(byteLength(line) / (maxWidth - 4)))
      }
    }
    return l + docs.length - 1
  }

  public get valid(): Promise<boolean> {
    return this.buffer.valid
  }

  public calculateFragments(docs: Documentation[], maxWidth: number): Fragment[] {
    let fragments: Fragment[] = []
    let idx = 0
    let currLine = 0
    let newLines: string[] = []
    let fill = false
    let positions = this.positions = []
    for (let doc of docs) {
      let lines: string[] = []
      let content = doc.content.replace(/\s+$/, '')
      let arr = content.split(/\r?\n/)
      if (['Error', 'Info', 'Warning', 'Hint'].indexOf(doc.filetype) !== -1) {
        fill = true
      }
      // let [start, end] = doc.active || []
      for (let str of arr) {
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
      newLines.push(...lines.filter(s => !/^\s*```/.test(s)))
      if (idx != docs.length - 1) {
        newLines.push('—')
        currLine = newLines.length
      }
      idx = idx + 1
    }
    let width = this.width = Math.min(Math.max(...newLines.map(s => this.getWidth(s))) + 2, maxWidth)
    this.lines = newLines.map(s => {
      if (s == '—') return '—'.repeat(width - 2)
      return s
    })
    return fragments
  }

  private getWidth(line: string): number {
    let { tabstop } = this
    line = line.replace(/\t/g, ' '.repeat(tabstop))
    return byteLength(line)
  }

  public async setDocuments(docs: Documentation[], maxWidth: number): Promise<void> {
    let fragments = this.calculateFragments(docs, maxWidth)
    let filetype = await this.nvim.eval('&filetype') as string
    if (workspace.isNvim) {
      fragments = fragments.reduce((p, c) => {
        p.push(...this.splitFragment(c, filetype))
        return p
      }, [])
    }
    if (this.enableHighlight) {
      let arr = await Promise.all(fragments.map(f => {
        return getHiglights(f.lines, f.filetype).then(highlights => {
          return highlights.map(highlight => {
            return Object.assign({}, highlight, { line: highlight.line + f.start })
          })
        })
      }))
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
          res.push({ lines, filetype: this.fixFiletype(filetype), start: curr - lines.length })
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
      res.push({ lines, filetype: this.fixFiletype(filetype), start: curr - lines.length })
      lines = []
    }
    return res
  }

  private fixFiletype(filetype: string): string {
    if (filetype == 'ts') return 'typescript'
    if (filetype == 'js') return 'javascript'
    if (filetype == 'bash') return 'sh'
    return filetype
  }

  public setLines(): void {
    let { buffer, lines, nvim, highlights } = this
    if (this.window) {
      nvim.call('win_execute', [this.window.id, 'call clearmatches([])'], true)
    } else {
      nvim.call('clearmatches', [], true)
    }
    buffer.clearNamespace(-1, 0, -1)
    buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    if (highlights.length) {
      let positions: [number, number, number?][] = []
      for (let highlight of highlights) {
        buffer.addHighlight({
          srcId: workspace.createNameSpace('coc-float'),
          ...highlight
        }).catch(_e => {
          // noop
        })
        if (highlight.isMarkdown) {
          let line = lines[highlight.line]
          if (line) {
            let before = line[characterIndex(line, highlight.colStart)]
            let after = line[characterIndex(line, highlight.colEnd) - 1]
            if (before == after && ['_', '`', '*'].indexOf(before) !== -1) {
              positions.push([highlight.line + 1, highlight.colStart + 1])
              positions.push([highlight.line + 1, highlight.colEnd])
            }
            if (highlight.colEnd - highlight.colStart == 2 && before == '\\') {
              positions.push([highlight.line + 1, highlight.colStart + 1])
            }
          }
        }
      }
      for (let arr of group(positions, 8)) {
        if (this.window) {
          nvim.call('win_execute', [this.window.id, `call matchaddpos('Conceal', ${JSON.stringify(arr)},11)`], true)
        } else {
          nvim.call('matchaddpos', ['Conceal', arr, 11], true)
        }
      }
    }
    for (let arr of group(this.positions || [], 8)) {
      arr = arr.filter(o => o[2] != 0)
      if (arr.length) {
        if (this.window) {
          nvim.call('win_execute', [this.window.id, `call matchaddpos('CocUnderline', ${JSON.stringify(arr)},12)`], true)
        } else {
          nvim.call('matchaddpos', ['CocUnderline', arr, 12], true)
        }
      }
    }
  }
}
