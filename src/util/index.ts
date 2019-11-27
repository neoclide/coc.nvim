import { Neovim } from '@chemzqm/neovim'
import { exec, ExecOptions } from 'child_process'
import debounce from 'debounce'
import fs from 'fs'
import isuri from 'isuri'
import mkdir from 'mkdirp'
import path from 'path'
import { Disposable, TextDocumentIdentifier } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import which from 'which'
import { MapMode } from '../types'
import * as platform from './platform'
import { Lazy } from './lazy'

export { platform }
const logger = require('./logger')('util-index')
const prefix = '[coc.nvim] '

export { Lazy }

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

export function getUri(fullpath: string, id: number, buftype: string, isCygwin: boolean): string {
  if (!fullpath) return `untitled:${id}`
  if (platform.isWindows && !isCygwin) fullpath = path.win32.normalize(fullpath)
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
  if (!platform.isWindows) {
    opts.shell = opts.shell || process.env.SHELL
  }
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
  if (mode == 'o' || mode == 'x' || mode == 'v') return '<C-U>'
  if (mode == 'n') return ''
  if (mode == 'i') return '<C-o>'
  if (mode == 's') return '<Esc>'
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

// consider textDocument without version to be valid
export function isDocumentEdit(edit: any): boolean {
  if (edit == null) return false
  if (!TextDocumentIdentifier.is(edit.textDocument)) return false
  if (!Array.isArray(edit.edits)) return false
  return true
}

export function concurrent(fns: (() => Promise<any>)[], limit = Infinity): Promise<any[]> {
  if (fns.length == 0) return Promise.resolve([])
  return new Promise((resolve, rejrect) => {
    let remain = fns.slice()
    let results = []
    let next = () => {
      if (remain.length == 0) {
        return resolve(results)
      }
      let list = remain.splice(0, limit)
      Promise.all(list.map(fn => fn())).then(res => {
        results.push(...res)
        next()
      }, rejrect)
    }
    next()
  })
}
