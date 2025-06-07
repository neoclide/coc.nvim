import { Position, Range, StringValue } from 'vscode-languageserver-types'
import type { CompleteOption, ExtendedCompleteItem, ISource } from '../completion/types'
import { UltiSnipsActions } from '../types'
import { defaultValue } from '../util'
import { getEnd } from '../util/position'
import { SnippetString } from './string'

export type UltiSnipsAction = 'preExpand' | 'postExpand' | 'postJump'

export type UltiSnipsOption = 'trimTrailingWhitespace' | 'removeWhiteSpace' | 'noExpand'

export interface UltiSnippetContext {
  id: string
  /**
   * line on insert
   */
  line: string
  /**
   * Range to replace, start.line should equal end.line
   */
  range: Range
  /**
   * Context python code.
   */
  context?: string
  /**
   * Regex trigger (python code)
   */
  regex?: string
  /**
   * Avoid python code eval when is true.
   */
  noPython?: boolean
  /**
   * Do not expand tabs
   */
  noExpand?: boolean
  /**
   * Trim all whitespaces from right side of snippet lines.
   */
  trimTrailingWhitespace?: boolean
  /**
   * Remove whitespace immediately before the cursor at the end of a line before jumping to the next tabstop
   */
  removeWhiteSpace?: boolean

  actions?: UltiSnipsActions
}

export interface SnippetFormatOptions {
  tabSize: number
  insertSpaces: boolean
  trimTrailingWhitespace?: boolean
  // options from ultisnips context
  noExpand?: boolean
  [key: string]: boolean | number | string | undefined
}

const stringStartRe = /\\A/
const conditionRe = /\(\?\(\w+\).+\|/
const commentRe = /\(\?#.*?\)/
const namedCaptureRe = /\(\?P<\w+>.*?\)/
const namedReferenceRe = /\(\?P=(\w+)\)/
const regex = new RegExp(`${commentRe.source}|${stringStartRe.source}|${namedCaptureRe.source}|${namedReferenceRe.source}`, 'g')

/**
 * Convert python regex to javascript regex,
 * throw error when unsupported pattern found
 */
export function convertRegex(str: string): string {
  if (str.indexOf('\\z') !== -1) {
    throw new Error('pattern \\z not supported')
  }
  if (str.indexOf('(?s)') !== -1) {
    throw new Error('pattern (?s) not supported')
  }
  if (str.indexOf('(?x)') !== -1) {
    throw new Error('pattern (?x) not supported')
  }
  if (str.indexOf('\n') !== -1) {
    throw new Error('pattern \\n not supported')
  }
  if (conditionRe.test(str)) {
    throw new Error('pattern (?id/name)yes-pattern|no-pattern not supported')
  }
  return str.replace(regex, (match, p1) => {
    if (match.startsWith('(?#')) return ''
    if (match.startsWith('(?P<')) return '(?' + match.slice(3)
    if (match.startsWith('(?P=')) return `\\k<${p1}>`
    // if (match == '\\A') return '^'
    return '^'
  })
}

/**
 * Action code from context or option
 */
export function getAction(opt: { actions?: { [key: string]: any } } | undefined, action: UltiSnipsAction): string | undefined {
  if (!opt || !opt.actions) return undefined
  return opt.actions[action]
}

export function shouldFormat(snippet: string): boolean {
  if (/^\s/.test(snippet)) return true
  if (snippet.indexOf('\n') !== -1) return true
  return false
}

export function normalizeSnippetString(snippet: string, indent: string, opts: SnippetFormatOptions): string {
  let lines = snippet.split(/\r?\n/)
  let ind = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
  let tabSize = defaultValue(opts.tabSize, 2)
  let noExpand = opts.noExpand
  let trimTrailingWhitespace = opts.trimTrailingWhitespace
  lines = lines.map((line, idx) => {
    let space = line.match(/^\s*/)[0]
    let pre = space
    let isTab = space.startsWith('\t')
    if (isTab && opts.insertSpaces && !noExpand) {
      pre = ind.repeat(space.length)
    } else if (!isTab && !opts.insertSpaces) {
      pre = ind.repeat(space.length / tabSize)
    }
    return (idx == 0 || (trimTrailingWhitespace && line.length == 0) ? '' : indent) + pre + line.slice(space.length)
  })
  return lines.join('\n')
}

/**
 * For static words, must be triggered by source option.
 * Used for completion of snippet choices.
 */
export class WordsSource implements ISource<ExtendedCompleteItem> {
  public readonly name = '$words'
  public readonly shortcut = ''
  public readonly triggerOnly = true
  public words: string[] = []
  public startcol: number | undefined

  public doComplete(opt: CompleteOption) {
    return {
      startcol: this.startcol,
      items: this.words.map(s => {
        return { word: s, filterText: opt.input }
      })
    }
  }
}

export const wordsSource = new WordsSource()

/**
 * Get range from base position and position, text
 */
export function getNewRange(base: Position, pos: Position, value: string): Range {
  const { line, character } = base
  const start: Position = {
    line: line + pos.line,
    character: pos.line == 0 ? character + pos.character : pos.character
  }
  return Range.create(start, getEnd(start, value))
}

export function getTextBefore(range: Range, text: string, pos: Position): string {
  let newLines = []
  let { line, character } = range.start
  let n = pos.line - line
  const lines = text.split('\n')
  for (let i = 0; i <= n; i++) {
    let line = lines[i]
    if (i == n) {
      newLines.push(line.slice(0, i == 0 ? pos.character - character : pos.character))
    } else {
      newLines.push(line)
    }
  }
  return newLines.join('\n')
}

export function getTextAfter(range: Range, text: string, pos: Position): string {
  let newLines = []
  let n = range.end.line - pos.line
  const lines = text.split('\n')
  let len = lines.length
  for (let i = 0; i <= n; i++) {
    let idx = len - i - 1
    let line = lines[idx]
    if (i == n) {
      let sc = range.start.character
      let from = idx == 0 ? pos.character - sc : pos.character
      newLines.unshift(line.slice(from))
    } else {
      newLines.unshift(line)
    }
  }
  return newLines.join('\n')
}

export function toSnippetString(snippet: string | SnippetString | StringValue): string {
  if (typeof snippet === 'string') {
    return snippet
  }
  if (typeof snippet.value === 'string') {
    return snippet.value
  }
  throw new TypeError(`Snippet should be string or has value as string`)
}
