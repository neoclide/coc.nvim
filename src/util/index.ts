import {Neovim } from 'neovim'
import debounce = require('debounce')
import {logger} from './logger'

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

export function getKeywordsRegStr(keywordOption: string, count: number):string {
  let parts = keywordOption.split(',')
  let str = ''
  for (let part of parts) {
    if (part == '@') {
      str += 'A-Za-z'
    } else if (part.length == 1) {
      str += part.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    } else if (/^\d+-\d+$/.test(part)) {
      let ms = part.match(/^(\d+)-(\d+)$/)
      str += `${String.fromCharCode(Number(ms[1]))}-${String.fromCharCode(Number(ms[2]))}`
    }
  }
  return `[${str}]`
}
