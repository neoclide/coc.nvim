import { attach, Neovim } from '@chemzqm/neovim'
import cp, { exec } from 'child_process'
import net from 'net'
import { Disposable } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import which from 'which'
import * as platform from './platform'

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

export function isCocItem(item: any): boolean {
  if (!item || !item.hasOwnProperty('user_data')) return false
  let { user_data } = item
  try {
    let res = JSON.parse(user_data)
    return res.cid != null
  } catch (e) {
    return false
  }
}

function getValidPort(port: number, cb: (port: number) => void): void {
  let server = net.createServer()
  server.listen(port, () => {
    server.once('close', () => {
      cb(port)
    })
    server.close()
  })
  server.on('error', () => {
    port += 1
    getValidPort(port, cb)
  })
}

export function getPort(port = 44877): Promise<number> {
  return new Promise(resolve => {
    getValidPort(port, result => {
      resolve(result)
    })
  })
}

export function getUri(fullpath: string, id: number): string {
  if (!fullpath) {
    let w = require('../workspace').default
    return `untitled:${w.cwd}/${id}`
  }
  if (/^\w+:\//.test(fullpath)) return fullpath
  return Uri.file(fullpath).toString()
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
