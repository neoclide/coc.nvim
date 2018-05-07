import {Neovim } from 'neovim'
import debounce = require('debounce')
import {logger} from './logger'
import unique = require('array-unique')

export type Callback =(arg: string) => void

function escapeSingleQuote(str: string):string {
  return str.replace(/'/g, "''")
}

// create dobounce funcs for each arg
export function contextDebounce(func: Callback, timeout: number):Callback {
  let funcMap: {[index: string] : Callback | null} = {}
  return (arg: string): void => {
    let fn = funcMap[arg]
    if (fn == null) {
      fn = debounce(func.bind(null, arg), timeout, true)
      funcMap[arg] = fn
    }
    fn(arg)
  }
}

export function wait(ms: number):Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function echoMsg(nvim:Neovim, line: string, hl: string):Promise<void> {
  return await nvim.command(`echohl ${hl} | echomsg '[complete.nvim] ${escapeSingleQuote(line)}' | echohl None"`)
}

export async function echoErr(nvim: Neovim, line: string):Promise<void> {
  return await echoMsg(nvim, line, 'Error')
}

export async function echoWarning(nvim: Neovim, line: string):Promise<void> {
  return await echoMsg(nvim, line, 'WarningMsg')
}

export async function echoErrors(nvim: Neovim, lines: string[]):Promise<void> {
  await nvim.call('complete#util#print_errors', lines)
}

function escapeChar(s:string):string {
  if (/^\w/.test(s)) return ''
  if (s === '-') return '\\-'
  if (s === '.') return '\\.'
  if (s === ':') return '\\:'
  return s
}

export function getKeywordsRegStr(keywordOption: string):string {
  let parts = keywordOption.split(',')
  let str = ''
  let chars = []

  parts = unique(parts)
  for (let part of parts) {
    if (part == '@') {
      str += '\\w'
    } else if (/^(\d+)-(\d+)$/.test(part)) {
      if (part === '48-57') continue
      let ms = part.match(/^(\d+)-(\d+)$/)
      // str += `${String.fromCharCode(Number(ms[1]))}-${String.fromCharCode(Number(ms[2]))}`
    } else if (/^\d+$/.test(part)) {
      chars.push(escapeChar(String.fromCharCode(Number(part))))
    } else if (part.length == 1) {
      chars.push(escapeChar(part))
    }
  }
  str += unique(chars).join('')
  return `[${str}]`
}
