import { attach, Neovim } from '@chemzqm/neovim'
import cp, { exec } from 'child_process'
import debounce from 'debounce'
import fs from 'fs'
import { Disposable } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import which from 'which'
import * as platform from './platform'
import isuri from 'isuri'

export { platform }
const logger = require('./logger')('util-index')
const prefix = '[coc.nvim] '

export enum FileSchemes {
  File = 'file',
  Untitled = 'untitled'
}

export function isSupportedScheme(scheme: string): boolean {
  return (
    [FileSchemes.File, FileSchemes.Untitled].indexOf(scheme as FileSchemes) >= 0
  )
}

export function escapeSingleQuote(str: string): string {
  return str.replace(/'/g, "''")
}

export function echoErr(nvim: Neovim, msg: string): void {
  echoMsg(nvim, prefix + msg, 'Error') // tslint:disable-line
}

export function echoWarning(nvim: Neovim, msg: string): void {
  echoMsg(nvim, prefix + msg, 'WarningMsg') // tslint:disable-line
}

export function echoMessage(nvim: Neovim, msg: string): void {
  echoMsg(nvim, prefix + msg, 'MoreMsg') // tslint:disable-line
}

export function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

function echoMsg(nvim: Neovim, msg: string, hl: string): void {
  nvim.call('coc#util#echo_messages', [hl, msg.split('\n')], true)
}

export function getUri(bufname: string, id: number, buftype: string): string {
  if (buftype == 'quickfix') return `quickfix:${process.cwd()}/${id}`
  if (buftype == 'nofile') return `nofile:${bufname}/${id}`
  if (!bufname) return `untitled:${process.cwd()}/${id}`
  bufname = bufname.replace(/\s/g, '%20')
  if (isuri.isValid(bufname)) return bufname
  return Uri.file(bufname).toString()
}

export function disposeAll(disposables: Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    if (item) {
      item.dispose()
    }
  }
}

export function executable(command: string): boolean {
  try {
    which.sync(command)
  } catch (e) {
    return false
  }
  return true
}

export function createNvim(): Neovim {
  let p = which.sync('nvim')
  let proc = cp.spawn(p, ['-u', 'NORC', '-i', 'NONE', '--embed', '--headless'], {
    shell: false
  })
  return attach({ proc })
}

export function runCommand(cmd: string, cwd: string, timeout?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timer
    if (timeout) {
      timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeout}s`))
      }, timeout * 1000)
    }
    exec(cmd, { cwd }, (err, stdout) => {
      if (timer) clearTimeout(timer)
      if (err) {
        reject(new Error(`exited with ${err.code}`))
        return
      }
      resolve(stdout)
    })
  })
}

export function watchFile(filepath: string, onChange: () => void): Disposable {
  let callback = debounce(onChange, 100)
  let watcher = fs.watch(filepath, {
    persistent: true,
    recursive: false,
    encoding: 'utf8'
  }, () => {
    callback()
  })
  return Disposable.create(() => {
    watcher.close()
  })
}

export function convertFiletype(filetype: string, map: { [index: string]: string }): string {
  if (filetype == 'javascript.jsx') return 'javascriptreact'
  if (filetype == 'typescript.jsx' || filetype == 'typescript.tsx') return 'typescriptreact'
  if (map[filetype]) return map[filetype]
  return filetype
}

export function isRunning(pid: number): boolean {
  try {
    let res: any = process.kill(pid, 0)
    return res == true
  }
  catch (e) {
    return e.code === 'EPERM'
  }
}
