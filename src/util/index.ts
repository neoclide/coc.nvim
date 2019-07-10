import { attach, Neovim } from '@chemzqm/neovim'
import path, { dirname } from 'path'
import cp, { exec, ExecOptions } from 'child_process'
import debounce from 'debounce'
import fs from 'fs'
import { Disposable, TextDocumentIdentifier } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import which from 'which'
import * as platform from './platform'
import isuri from 'isuri'
import mkdir from 'mkdirp'
import { MapMode } from '../types'

export { platform }
const logger = require('./logger')('util-index')
const prefix = '[coc.nvim] '

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
  let method = process.env.VIM_NODE_RPC == '1' ? 'callTimer' : 'call'
  nvim[method]('coc#util#echo_messages', [hl, msg.split('\n')], true)
}

export function getUri(fullpath: string, id: number, buftype: string): string {
  if (!fullpath) return `untitled:${id}`
  if (platform.isWindows) fullpath = path.win32.normalize(fullpath)
  if (path.isAbsolute(fullpath)) return URI.file(fullpath).toString()
  if (isuri.isValid(fullpath)) return URI.parse(fullpath).toString()
  if (buftype != '') return `${buftype}:${id}`
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

export function runCommand(cmd: string, opts: ExecOptions = {}, timeout?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timer
    if (timeout) {
      timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeout}s`))
      }, timeout * 1000)
    }
    exec(cmd, opts, (err, stdout, stderr) => {
      if (timer) clearTimeout(timer)
      if (err) {
        reject(new Error(`exited with ${err.code}\n${err}\n${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

export function watchFile(filepath: string, onChange: () => void): Disposable {
  let callback = debounce(onChange, 100)
  try {
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
  } catch (e) {
    return Disposable.create(() => {
      // noop
    })
  }
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

export async function mkdirp(path: string, mode?: number): Promise<boolean> {
  return new Promise(resolve => {
    mkdir(path, { mode }, err => {
      if (err) return resolve(false)
      resolve(true)
    })
  })
}

function nfcall<R>(fn: Function, ...args: any[]): Promise<R> {
  return new Promise<R>((c, e) => fn(...args, (err: any, r: any) => err ? e(err) : c(r)))
}

// consider textDocument without version to be valid
export function isDocumentEdit(edit: any): boolean {
  if (edit == null) return false
  if (!TextDocumentIdentifier.is(edit.textDocument)) return false
  if (!Array.isArray(edit.edits)) return false
  return true
}
