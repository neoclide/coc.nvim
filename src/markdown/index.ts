'use strict'
import { marked } from 'marked'
import { Documentation, HighlightItem } from '../types'
import { parseAnsiHighlights } from '../util/ansiparse'
import * as Is from '../util/is'
import { stripAnsi } from '../util/node'
import { byteIndex, byteLength } from '../util/string'
import Renderer from './renderer'

export interface MarkdownParseOptions {
  breaks?: boolean
  excludeImages?: boolean
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

enum FiletypeHighlights {
  Error = 'CocErrorFloat',
  Warning = 'CocWarningFloat',
  Info = 'CocInfoFloat',
  Hint = 'CocHintFloat',
}

const filetyepsMap = {
  js: 'javascript',
  ts: 'typescript',
  bash: 'sh'
}
const ACTIVE_HL_GROUP = 'CocFloatActive'
const HEADER_PREFIX = '\x1b[35m'
const DIVIDING_LINE_HI_GROUP = 'CocFloatDividingLine'
const MARKDOWN = 'markdown'
const DOTS = '```'
const TXT = 'txt'
const DIVIDE_CHARACTER = '─'
const DIVIDE_LINE = '───'

export function toFiletype(match: null | undefined | string): string {
  if (!match) return TXT
  let mapped = filetyepsMap[match]
  return Is.string(mapped) ? mapped : match
}

export function parseDocuments(docs: Documentation[], opts: MarkdownParseOptions = {}): DocumentInfo {
  let lines: string[] = []
  let highlights: HighlightItem[] = []
  let codes: CodeBlock[] = []
  let idx = 0
  for (let doc of docs) {
    let currline = lines.length
    let { content, filetype } = doc
    let hls = doc.highlights
    if (filetype == MARKDOWN) {
      let info = parseMarkdown(content, opts)
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
      let hlGroup = FiletypeHighlights[doc.filetype]
      if (Is.string(hlGroup)) {
        codes.push({ hlGroup, startLine: currline, endLine: currline + parts.length })
      } else {
        codes.push({ filetype: doc.filetype, startLine: currline, endLine: currline + parts.length })
      }
      lines.push(...parts)
    }
    if (Array.isArray(hls)) {
      highlights.push(...hls.map(o => {
        return Object.assign({}, o, { lnum: o.lnum + currline })
      }))
    }
    if (Array.isArray(doc.active)) {
      let arr = getHighlightItems(content, currline, doc.active)
      if (arr.length) highlights.push(...arr)
    }
    if (idx != docs.length - 1) {
      highlights.push({
        lnum: lines.length,
        hlGroup: DIVIDING_LINE_HI_GROUP,
        colStart: 0,
        colEnd: -1
      })
      lines.push(DIVIDE_CHARACTER) // dividing line
    }
    idx = idx + 1
  }
  return { lines, highlights, codes }
}

/**
 * Get 'CocSearch' highlights from offset range
 */
export function getHighlightItems(content: string, currline: number, active: [number, number]): HighlightItem[] {
  let res: HighlightItem[] = []
  let [start, end] = active
  let lines = content.split(/\r?\n/)
  let used = 0
  let inRange = false
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (!inRange) {
      if (used + line.length > start) {
        inRange = true
        let colStart = byteIndex(line, start - used)
        if (used + line.length > end) {
          let colEnd = byteIndex(line, end - used)
          inRange = false
          res.push({ colStart, colEnd, lnum: i + currline, hlGroup: ACTIVE_HL_GROUP })
          break
        } else {
          let colEnd = byteLength(line)
          res.push({ colStart, colEnd, lnum: i + currline, hlGroup: ACTIVE_HL_GROUP })
        }
      }
    } else {
      if (used + line.length > end) {
        let colEnd = byteIndex(line, end - used)
        res.push({ colStart: 0, colEnd, lnum: i + currline, hlGroup: ACTIVE_HL_GROUP })
        inRange = false
        break
      } else {
        let colEnd = byteLength(line)
        res.push({ colStart: 0, colEnd, lnum: i + currline, hlGroup: ACTIVE_HL_GROUP })
      }
    }
    used = used + line.length + 1
  }
  return res
}

/**
 * Parse markdown for lines, highlights & codes
 */
export function parseMarkdown(content: string, opts: MarkdownParseOptions): DocumentInfo {
  marked.setOptions({
    renderer: new Renderer(),
    gfm: true,
    breaks: Is.boolean(opts.breaks) ? opts.breaks : true
  })
  let lines: string[] = []
  let highlights: HighlightItem[] = []
  let codes: CodeBlock[] = []
  let currline = 0
  let inCodeBlock = false
  let filetype: string
  let startLnum = 0
  let parsed = marked(content)
  let links = Renderer.getLinks()
  parsed = parsed.replace(/\s*$/, '')
  if (links.length) {
    parsed = parsed + '\n\n' + links.join('\n')
  }
  let parsedLines = parsed.split(/\n/)
  for (let i = 0; i < parsedLines.length; i++) {
    let line = parsedLines[i]
    if (!line.length) {
      let pre = lines[lines.length - 1]
      // Skip current line when previous line is empty
      if (!pre) continue
      let next = parsedLines[i + 1]
      // Skip empty line when next is code block or hr or header
      if (!next || next.startsWith(DOTS) || next.startsWith(DIVIDE_CHARACTER)) continue
      lines.push(line)
      currline++
      continue
    }
    if (opts.excludeImages && line.indexOf('![') !== -1) {
      line = line.replace(/\s*!\[.*?\]\(.*?\)/g, '')
      if (!stripAnsi(line).trim().length) continue
    }
    let ms = line.match(/^\s*```\s*(\S+)?/)
    if (ms) {
      if (!inCodeBlock) {
        let pre = parsedLines[i - 1]
        if (pre && /^\s*```\s*/.test(pre)) {
          lines.push('')
          currline++
        }
        inCodeBlock = true
        filetype = toFiletype(ms[1])
        startLnum = currline
      } else {
        inCodeBlock = false
        codes.push({
          filetype,
          startLine: startLnum,
          endLine: currline
        })
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
    if (line === DIVIDE_LINE) {
      highlights.push({
        hlGroup: DIVIDING_LINE_HI_GROUP,
        lnum: currline,
        colStart: 0,
        colEnd: -1
      })
    } else if (res.highlights) {
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
