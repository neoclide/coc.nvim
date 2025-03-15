import { Range } from '@chemzqm/neovim/lib/types'
import { UltiSnipsActions } from '../types'
import * as Is from '../util/is'
import type { Placeholder, TextmateSnippet } from './parser'

export type UltiSnipsAction = 'preExpand' | 'postExpand' | 'postJump'

export interface UltiSnippetContext {
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

/**
 * Synchronize changed placeholder to all parent snippets.
 * TODO test 不能用，snippet 可能需要要执行完包含的 pyBlocks
 */
export function synchronizeParentSnippets(snippet: TextmateSnippet): void {
  if (!Is.number(snippet?.parentIndex)) return
  let placeholder = snippet.parent as Placeholder
  let s = placeholder.snippet
  s.onPlaceholderUpdate(placeholder)
  synchronizeParentSnippets(s)
}
