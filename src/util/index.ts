import { attach, Neovim } from '@chemzqm/neovim'
import path from 'path'
import cp, { exec, ExecOptions } from 'child_process'
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
  nvim.callTimer('coc#util#echo_messages', [hl, msg.split('\n')], true)
}

export function getUri(fullpath: string, id: number, buftype: string): string {
  if (buftype != '') return `${buftype}:${id}`
  if (!fullpath) return `untitled:${id}`
  if (path.isAbsolute(fullpath)) return Uri.file(fullpath).toString()
  if (isuri.isValid(fullpath)) return Uri.parse(fullpath).toString()
  return `unknown:${id}`
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

export function runCommand(cmd: string, opts: ExecOptions = {}, timeout?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timer
    if (timeout) {
      timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeout}s`))
      }, timeout * 1000)
    }
    exec(cmd, opts, (err, stdout) => {
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
