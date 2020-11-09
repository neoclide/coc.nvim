import marked from 'marked'
import Renderer from './renderer'
import { parseAnsiHighlights } from '../util/ansiparse'
import { Documentation } from '../types'
export const diagnosticFiletypes = ['Error', 'Warning', 'Info', 'Hint']
const logger = require('../util/logger')('markdown-index')

marked.setOptions({
  smartypants: true,
  renderer: new Renderer()
})

export interface HighlightItem {
  lnum: number // 0 based
  hlGroup: string
  colStart: number // 0 based
  colEnd: number
}

export interface CodeBlock {
  /**
   * Must have filetype or hlgroup
   */
  filetype?: string
  hlGroup?: string
  startLine: number // 0 based
  endLine: number
}

export interface DocumentInfo {
  lines: string[]
  highlights: HighlightItem[]
  codes: CodeBlock[]
}

export function parseDocuments(docs: Documentation[]): DocumentInfo {
  let lines: string[] = []
  let highlights: HighlightItem[] = []
  let codes: CodeBlock[] = []
  let idx = 0
  for (let doc of docs) {
    let currline = lines.length
    let { content, filetype } = doc
    if (filetype == 'markdown') {
      let info = parseMarkdown(content)
      codes.push(...info.codes.map(o => {
        o.startLine = o.startLine + currline
        o.endLine = o.endLine + currline
        return o
      }))
      highlights.push(...info.highlights.map(o => {
        o.lnum = o.lnum + currline
        return o
      }))
      lines.push(...info.lines)
    } else {
      let parts = content.trim().split(/\r?\n/)
      if (diagnosticFiletypes.includes(doc.filetype)) {
        codes.push({ hlGroup: `Coc${filetype}Float`, startLine: currline, endLine: currline + parts.length })
      } else {
        codes.push({ filetype: doc.filetype, startLine: currline, endLine: currline + parts.length })
      }
      lines.push(...parts)
    }
    if (idx != docs.length - 1) {
      lines.push('—') // separate line
    }
    idx = idx + 1
  }
  return { lines, highlights, codes }
}

export function parseMarkdown(content: string): DocumentInfo {
  let lines: string[] = []
  let highlights: HighlightItem[] = []
  let codes: CodeBlock[] = []
  let currline = 0
  let inCodeBlock = false
  let filetype: string
  let startLnum = 0
  let parsed = marked(content)
  for (let line of parsed.replace(/\s*$/, '').split(/\n/)) {
    if (!line.length) {
      let pre = lines[lines.length - 1]
      if (pre.length) {
        lines.push(line)
        currline++
      }
      continue
    }
    if (line.startsWith('```')) {
      let pre = lines[lines.length - 1]
      if (!inCodeBlock) {
        inCodeBlock = true
        filetype = line.replace(/^```\s*/, '')
        if (filetype == 'js') filetype = 'javascript'
        if (filetype == 'ts') filetype = 'typescript'
        startLnum = currline
      } else {
        inCodeBlock = false
        codes.push({
          filetype,
          startLine: startLnum,
          endLine: currline
        })
      }
      if (pre.length) {
        lines.push('')
        currline++
      }
      continue
    }
    if (inCodeBlock) {
      // no parse
      lines.push(line)
      currline++
      continue
    }
    let res = parseAnsiHighlights(line, true)
    if (res.highlights) {
      for (let hi of res.highlights) {
        let { hlGroup, span } = hi
        highlights.push({
          hlGroup,
          lnum: currline,
          colStart: span[0],
          colEnd: span[1]
        })
      }
    }
    lines.push(res.line)
    currline++
  }
  return { lines, highlights, codes }
}
