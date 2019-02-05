import { attach, Neovim } from '@chemzqm/neovim'
import path from 'path'
import cp, { exec } from 'child_process'
import debounce from 'debounce'
import fs from 'fs'
import { Disposable } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import which from 'which'
import * as platform from './platform'
import isuri from 'isuri'
import { MapMode } from '../types'

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
  if (buftype == 'quickfix') return Uri.parse(`quickfix:${process.cwd()}/${id}`).toString()
  if (buftype == 'nofile') return Uri.parse(`nofile:${bufname}/${id}`).toString()
  if (buftype == 'terminal') {
    if (bufname.startsWith('!')) {
      return Uri.parse(`term://${bufname.slice(1)}`).toString()
    }
    return Uri.parse(bufname).toString()
  }
  if (!bufname) return Uri.parse(`untitled:${process.cwd()}/${id}`).toString()
  if (path.isAbsolute(bufname)) return Uri.file(bufname).toString()
  if (isuri.isValid(bufname)) return Uri.parse(bufname).toString()
  return Uri.parse(`nofile:${bufname}/${id}`).toString()
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

export function isRunning(pid: number): boolean {
  try {
    let res: any = process.kill(pid, 0)
    return res == true
  }
  catch (e) {
    return e.code === 'EPERM'
  }
}

export function getKeymapModifier(mode: MapMode): string {
  if (mode == 'n' || mode == 'v') return ''
  if (mode == 'i') return '<C-o>'
  if (mode == 's' || mode == 'x') return '<Esc>'
  return ''
}
