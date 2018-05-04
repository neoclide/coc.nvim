import {Neovim } from 'neovim'

export function wait(ms: number):Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function echoErr(nvim: Neovim, line: string):Promise<void> {
  return await nvim.command(`echoerr '${line.replace(/'/g, "''")}'`)
}

export function echoErrors(nvim: Neovim, lines: string[]):void {
  nvim.call('complete#util#print_errors', lines)
}
