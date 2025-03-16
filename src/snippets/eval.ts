'use strict'
import { Neovim } from '@chemzqm/neovim'
import { exec, ExecOptions } from 'child_process'
import { isVim } from '../util/constants'
import { promisify } from '../util/node'
import { byteLength, toText } from '../util/string'
import events from '../events'
import { UltiSnippetOption } from '../types'
import { UltiSnippetContext } from './util'
import { Range } from 'vscode-languageserver-types'
export type EvalKind = 'vim' | 'python' | 'shell'

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
  let start = `(${range.start.line},${byteLength(line, range.start.character)})`
  let end = `(${range.start.line},${byteLength(line, range.end.character)})`
  let indent = line.match(/^\s*/)[0]
  pyCodes.push(`snip = SnippetUtil("${escapeString(indent)}", ${start}, ${end}, context if 'context' in locals() else None)`)
  return pyCodes
}

/**
 * Python code for specific snippet `context` and `match`
 */
export function getSnippetPythonCode(context: UltiSnippetContext): string[] {
  const pyCodes: string[] = []
  let { range, regex, line } = context
  if (context.context) {
    pyCodes.push(`snip = ContextSnippet()`)
    pyCodes.push(`context = ${context.context}`)
  } else {
    pyCodes.push(`context = None`)
  }
  if (regex && Range.is(range)) {
    let trigger = line.slice(range.start.character, range.end.character)
    pyCodes.push(`pattern = re.compile("${escapeString(regex)}")`)
    pyCodes.push(`match = pattern.search("${escapeString(trigger)}")`)
  } else {
    pyCodes.push(`match = None`)
  }
  return pyCodes
}

export function getInitialPythonCode(context: UltiSnippetContext): string[] {
  let pyCodes: string[] = [
    'import re, os, vim, string, random',
    `path = vim.eval('coc#util#get_fullpath()') or ""`,
    `fn = os.path.basename(path)`,
  ]
  pyCodes.push(...getSnippetPythonCode(context))
  return pyCodes
}

export async function executePythonCode(nvim: Neovim, codes: string[], wrap = false) {
  let lines = [...codes]
  if (wrap) lines = [
    '_snip = None',
    'if "snip" in locals():',
    '    _snip = snip',
    ...codes,
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
