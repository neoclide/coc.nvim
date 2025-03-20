'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Range } from '@chemzqm/neovim/lib/types'
import { exec, ExecOptions } from 'child_process'
import { isVim } from '../util/constants'
import { promisify } from '../util/node'
import { toText } from '../util/string'
import events from '../events'
import { UltiSnippetOption, UltiSnipsActions } from '../types'
export type EvalKind = 'vim' | 'python' | 'shell'

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

export function getAction(opt: { actions?: { [key: string]: any } } | undefined, action: UltiSnipsAction): string | undefined {
  if (!opt || !opt.actions) return undefined
  return opt.actions[action]
}

/**
 * Eval code for code placeholder.
 */
export async function evalCode(nvim: Neovim, kind: EvalKind, code: string, curr: string): Promise<string> {
  if (kind == 'vim') {
    let res = await nvim.eval(code)
    return res.toString()
  }

  if (kind == 'shell') {
    let opts: ExecOptions = { windowsHide: true }
    if (process.env.SHELL) opts.shell = process.env.shell
    let res = await promisify(exec)(code, opts)
    return res.stdout.replace(/\s*$/, '')
  }

  let lines = [`snip._reset("${escapeString(curr)}")`]
  lines.push(...code.split(/\r?\n/).map(line => line.replace(/\t/g, '    ')))
  await executePythonCode(nvim, lines)
  let res = await nvim.call(`pyxeval`, 'str(snip.rv)') as string
  return toText(res)
}

export function prepareMatchCode(snip: UltiSnippetContext): string {
  let { range, regex, line } = snip
  let pyCodes: string[] = []
  if (regex && range != null) {
    let trigger = line.slice(range.start.character, range.end.character)
    pyCodes.push(`pattern = re.compile("${escapeString(regex)}")`)
    pyCodes.push(`match = pattern.search("${escapeString(trigger)}")`)
  } else {
    pyCodes.push(`match = None`)
  }
  return pyCodes.join('\n')
}

export function hasPython(snip?: UltiSnippetContext | UltiSnippetOption): boolean {
  if (!snip) return false
  if (snip.context) return true
  if (snip.actions && Object.keys(snip.actions).length > 0) return true
  return false
}

export function preparePythonCodes(snip: UltiSnippetContext): string[] {
  let { range, line } = snip
  let pyCodes: string[] = [
    'import re, os, vim, string, random',
    `path = vim.eval('coc#util#get_fullpath()') or ""`,
    `fn = os.path.basename(path)`,
  ]
  let start = `(${range.start.line},${Buffer.byteLength(line.slice(0, range.start.character))})`
  let end = `(${range.start.line},${Buffer.byteLength(line.slice(0, range.end.character))})`
  let indent = line.match(/^\s*/)[0]
  pyCodes.push(`snip = SnippetUtil("${escapeString(indent)}", ${start}, ${end}, context if 'context' in locals() else None)`)
  return pyCodes
}

export function getContextCode(context?: string): string[] {
  let pyCodes: string[] = [
    'import re, os, vim, string, random',
    `path = vim.eval('coc#util#get_fullpath()') or ""`,
    `fn = os.path.basename(path)`,
  ]
  if (context) {
    pyCodes.push(`snip = ContextSnippet()`)
    pyCodes.push(`context = ${context}`)
  } else {
    pyCodes.push(`context = None`)
  }
  return pyCodes
}

export async function executePythonCode(nvim: Neovim, codes: string[], wrap = false) {
  let lines = [...codes]
  if (wrap) lines = [
    '_snip = None',
    'if "snip" in locals():',
    '    _snip = snip',
    ...codes,
    `__snip = snip`,
    `snip = _snip`
  ]
  lines.unshift(`__requesting = ${events.requesting ? 'True' : 'False'}`)
  try {
    await nvim.command(`pyx ${addPythonTryCatch(lines.join('\n'))}`)
  } catch (e: any) {
    let err = new Error(e.message)
    err.stack = `Error on execute python code:\n${codes.join('\n')}\n` + e.stack
    throw err
  }
}

export function getVariablesCode(values: { [index: number]: string }): string {
  let keys = Object.keys(values)
  if (keys.length == 0) return `t = ()`
  let maxIndex = Math.max.apply(null, keys.map(v => Number(v)))
  let vals = (new Array(maxIndex)).fill('""')
  for (let [idx, val] of Object.entries(values)) {
    vals[idx] = `"${escapeString(val)}"`
  }
  return `t = (${vals.join(',')},)`
}

/**
 * vim8 doesn't throw any python error with :py command
 * we have to use g:errmsg since v:errmsg can't be changed in python script.
 */
export function addPythonTryCatch(code: string, force = false): string {
  if (!isVim && force === false) return code
  let lines = [
    'import traceback, vim',
    `vim.vars['errmsg'] = ''`,
    'try:',
  ]
  lines.push(...code.split('\n').map(line => '    ' + line))
  lines.push('except Exception as e:')
  lines.push(`    vim.vars['errmsg'] = traceback.format_exc()`)
  return lines.join('\n')
}

function escapeString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
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
