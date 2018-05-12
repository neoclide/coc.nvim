import {Neovim } from 'neovim'
import debounce = require('debounce')
import unique = require('array-unique')
const logger = require('./logger')()

export type Callback =(arg: string) => void

function escapeSingleQuote(str: string):string {
  return str.replace(/'/g, "''")
}

export function equalChar(a: string, b:string, icase:boolean):boolean {
  if (icase) return a.toLowerCase() === b.toLowerCase()
  return a === b
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

export function wait(ms: number):Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

async function echoMsg(nvim:Neovim, line: string, hl: string):Promise<void> {
  try {
    await nvim.command(`echohl ${hl} | echomsg '[coc.nvim] ${escapeSingleQuote(line)}' | echohl None"`)
  } catch (e) {
    logger.error(e.stack)
  }
  return
}

export async function echoErr(nvim: Neovim, line: string):Promise<void> {
  return await echoMsg(nvim, line, 'Error')
}

export async function echoWarning(nvim: Neovim, line: string):Promise<void> {
  return await echoMsg(nvim, line, 'WarningMsg')
}

export async function echoErrors(nvim: Neovim, lines: string[]):Promise<void> {
  await nvim.call('coc#util#print_errors', lines)
}
