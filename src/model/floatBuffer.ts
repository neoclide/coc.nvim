import { Buffer, Neovim } from '@chemzqm/neovim'
import { Highlight, getHiglights } from '../util/highlight'
import { characterIndex, byteLength } from '../util/string'
import { group } from '../util/array'
import { Documentation, Fragment } from '../types'
import { Chars } from './chars'
const logger = require('../util/logger')('model-floatBuffer')

export default class FloatBuffer {
  private lines: string[] = []
  private highlights: Highlight[]
  private chars = new Chars('@,48-57,_192-255,<,>,$,#,-,`,*')
  private positions: [number, number, number?][]
  public width = 0
  constructor(
    private buffer: Buffer,
    private nvim: Neovim,
    private srcId: number) {
  }

  public async setDocuments(docs: Documentation[], maxWidth: number): Promise<void> {
    let fragments: Fragment[] = []
    let idx = 0
    let currLine = 0
    let newLines: string[] = []
    let fill = false
    let positions = this.positions = []
    for (let doc of docs) {
      let isMarkdown = doc.filetype == 'markdown'
      let lines: string[] = []
      let content = doc.content.replace(/\r?\n/g, '\n')
      let arr = content.replace(/\t/g, '  ').split('\n')
      let inBlock = false
      if (['Error', 'Info', 'Warning', 'Hint'].indexOf(doc.filetype) !== -1) {
        fill = true
      }
      // join the lines when necessary
      arr = arr.reduce((list, curr) => {
        if (isMarkdown && curr.startsWith('```')) {
          inBlock = !inBlock
        }
        if (list.length && curr) {
          let pre = list[list.length - 1]
          if (!inBlock && !isSingleLine(pre) && !isBreakCharacter(curr[0])) {
            list[list.length - 1] = pre + ' ' + curr
            return list
          }
        }
        list.push(curr)
        return list
      }, [])
      let { active } = doc
      for (let str of arr) {
        let len = byteLength(str)
        if (len > maxWidth - 2) {
          // don't split on word
          let parts = this.softSplit(str, maxWidth - 2)
          if (active) {
            let count = 0
            let inLine = false
            let idx = 1
            let total = active[1] - active[0]
            for (let line of parts) {
              if (count >= total) break
              if (!inLine && active[0] < line.length) {
                inLine = true
                let len = line.length > active[1] ? total : line.length - active[0]
                count = len
                positions.push([currLine + idx, active[0] + 2, len])
              } else if (inLine && total > count) {
                let len = (total - count) > line.length ? line.length : total - count
                count = count + len
                positions.push([currLine + idx, 2, len])
              }
              idx = idx + 1
            }
          }
          lines.push(...parts)
        } else {
          lines.push(str)
          if (active) positions.push([currLine + 1, active[0] + 2, active[1] - active[0]])
        }
      }
      if (!lines[lines.length - 1].trim().length) {
        lines = lines.slice(0, lines.length - 1)
      }
      lines = lines.map(s => s.length ? ' ' + s : '')
      fragments.push({
        start: currLine,
        lines,
        filetype: doc.filetype
      })
      newLines.push(...lines)
      if (idx != docs.length - 1) {
        newLines.push('—')
        currLine = currLine + lines.length + 1
      }
      idx = idx + 1
    }
    let width = this.width = Math.max(...newLines.map(s => byteLength(s))) + 1
    this.lines = newLines.map(s => {
      if (s == '—') return '—'.repeat(width)
      if (fill) return s + ' '.repeat(width - byteLength(s))
      return s
    })
    fragments = fragments.reduce((p, c) => {
      p.push(c, ...this.getCodeFragments(c))
      return p
    }, [])
    let arr = await Promise.all(fragments.map(f => {
      return getHiglights(f.lines, f.filetype).then(highlights => {
        return highlights.map(highlight => {
          return Object.assign({}, highlight, { line: highlight.line + f.start })
        })
      })
    }))
    this.highlights = arr.reduce((p, c) => p.concat(c), [])
  }

  public getCodeFragments(fragment: Fragment): Fragment[] {
    if (fragment.filetype !== 'markdown') return []
    let res: Fragment[] = []
    let filetype: string
    let lines: string[] = []
    let start = fragment.start
    let inBlock = false
    let count = 0
    for (let line of fragment.lines) {
      let ms = line.match(/^\s*```\s*(\w+)?/)
      if (ms && ms[1]) {
        inBlock = true
        filetype = ms[1]
        lines = []
        start = fragment.start + count + 1
      } else if (ms) {
        inBlock = false
        if (lines.length && filetype) {
          res.push({
            filetype: this.fixFiletype(filetype),
            start,
            lines
          })
        }
      } else if (inBlock) {
        lines.push(line)
      }
      count = count + 1
    }
    return res
  }

  private fixFiletype(filetype: string): string {
    if (filetype == 'ts') return 'typescript'
    if (filetype == 'js') return 'javascript'
    return filetype
  }

  public get height(): number {
    return this.lines.length
  }

  public setLines(): void {
    let { buffer, lines, nvim, highlights, srcId } = this
    nvim.call('clearmatches', [], true)
    buffer.clearNamespace(-1)
    buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    if (highlights.length) {
      let positions: [number, number, number?][] = []
      for (let highlight of highlights) {
        buffer.addHighlight({
          srcId,
          hlGroup: highlight.hlGroup,
          line: highlight.line,
          colStart: highlight.colStart,
          colEnd: highlight.colEnd
        })
        if (highlight.isMarkdown) {
          let line = lines[highlight.line]
          let before = line[characterIndex(line, highlight.colStart)]
          let after = line[characterIndex(line, highlight.colEnd) - 1]
          if (before == after && ['_', '`', '*'].indexOf(before) !== -1) {
            positions.push([highlight.line + 1, highlight.colStart + 1])
            positions.push([highlight.line + 1, highlight.colEnd])
          }
        }
      }
      for (let arr of group(positions, 8)) {
        nvim.call('matchaddpos', ['Conceal', arr], true)
      }
    }
    if (this.positions.length) {
      for (let arr of group(this.positions, 8)) {
        nvim.call('matchaddpos', ['CocUnderline', arr], true)
      }
    }
  }

  private softSplit(line: string, maxWidth: number): string[] {
    let { chars } = this
    let res: string[] = []
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
