'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Range } from 'vscode-languageserver-types'
import events from '../events'
import { UltiSnippetOption } from '../types'
import { isVim } from '../util/constants'
import { UltiSnippetContext } from './util'
export type EvalKind = 'vim' | 'python' | 'shell'

const contexts_var = '__coc_ultisnip_contexts'

let context_id = 1

export function generateContextId(bufnr: number): string {
  return `${bufnr}-${context_id++}`
}

export function hasPython(snip?: UltiSnippetContext | UltiSnippetOption): boolean {
  if (!snip) return false
  if (snip.context) return true
  if (snip.actions && Object.keys(snip.actions).length > 0) return true
  return false
}

export function getResetPythonCode(context: UltiSnippetContext): string[] {
  const pyCodes: string[] = []
  pyCodes.push(`${contexts_var} = ${contexts_var} if '${contexts_var}' in locals() else {}`)
  pyCodes.push(`context = ${contexts_var}.get('${context.id}', {}).get('context', None)`)
  pyCodes.push(`match = ${contexts_var}.get('${context.id}', {}).get('match', None)`)
  return pyCodes
}

export function getPyBlockCode(snip: UltiSnippetContext): string[] {
  let { range, line } = snip
  let pyCodes: string[] = [
    'import re, os, vim, string, random',
    `path = vim.eval('coc#util#get_fullpath()') or ""`,
    `fn = os.path.basename(path)`,
  ]
  let start = `(${range.start.line},${range.start.character})`
  let end = `(${range.start.line},${range.end.character})`
  let indent = line.match(/^\s*/)[0]
  pyCodes.push(...getResetPythonCode(snip))
  pyCodes.push(`snip = SnippetUtil("${escapeString(indent)}", ${start}, ${end}, context)`)
  return pyCodes
}

export function getInitialPythonCode(context: UltiSnippetContext): string[] {
  let pyCodes: string[] = [
    'import re, os, vim, string, random',
    `path = vim.eval('coc#util#get_fullpath()') or ""`,
    `fn = os.path.basename(path)`,
  ]
  let { range, regex, line, id } = context
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
  // save 'context and 'match' for synchronize and actions.
  pyCodes.push(`${contexts_var} = ${contexts_var} if '${contexts_var}' in locals() else {}`)
  let prefix = id.match(/^\w+-/)[0]
  // keep context of current buffer only.
  pyCodes.push(`${contexts_var} = {k: v for k, v in ${contexts_var}.items() if k.startswith('${prefix}')}`)
  pyCodes.push(`${contexts_var}['${context.id}'] = {'context': context, 'match': match}`)
  return pyCodes
}

export async function executePythonCode(nvim: Neovim, codes: string[]) {
  if (codes.length == 0) return
  let lines = [...codes]
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

export function escapeString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
}
