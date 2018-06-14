import {
  Disposable,
  TextDocument,
  TextDocumentContentChangeEvent,
} from 'vscode-languageserver-protocol'
import {Neovim} from 'neovim'
import {Event, Emitter} from './event'
import * as fileSchemes from './fileSchemes'
import Uri, {UriComponents} from './uri'
import * as platform from './platform'
export {
  Event,
  Emitter as EventEmitter,
  Disposable,
  Uri,
  UriComponents,
  platform,
  fileSchemes,
}
import debounce = require('debounce')
import net = require('net')
const logger = require('./logger')('util-index')
const prefix = '[coc.nvim] '

export type Callback = (arg: number|string) => void

export function escapeSingleQuote(str: string):string {
  return str.replace(/'/g, "''")
}

export async function echoErr(nvim: Neovim, msg: string):Promise<void> {
  return await echoMsg(nvim, prefix + msg, 'Error')
}

export async function echoWarning(nvim: Neovim, msg: string):Promise<void> {
  return await echoMsg(nvim, prefix + msg, 'WarningMsg')
}

export async function echoMessage(nvim: Neovim, msg: string):Promise<void> {
  return await echoMsg(nvim, prefix + msg, 'MoreMsg')
}

export function getUserData(item:any):{[index: string]: any} | null {
  let userData = item.user_data
  if (!userData) return null
  try {
    let res = JSON.parse(userData)
    return res.hasOwnProperty('cid') ? res : null
  } catch (e) {
    return null
  }
}

// create dobounce funcs for each arg
export function contextDebounce(func: Callback, timeout: number):Callback {
  let funcMap: {[index: string] : Callback | null} = {}
  return (arg: string | number): void => {
    let fn = funcMap[arg]
    if (fn == null) {
      fn = debounce(func.bind(null, arg), timeout, false)
      funcMap[arg.toString()] = fn
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

async function echoMsg(nvim:Neovim, msg: string, hl: string):Promise<void> {
  try {
    await nvim.call('coc#util#echo_messages', [hl, msg.split('\n')])
  } catch (e) {
    logger.error(e.stack)
  }
  return
}

export function isCocItem(item: any):boolean {
  if (!item ||!item.user_data) return false
  if (Object.keys(item).length == 0) return false
  let {user_data} = item
  try {
    let res = JSON.parse(user_data)
    return res.cid != null
  } catch (e) {
    return false
  }
}

export function filterWord(input: string, word: string, icase: boolean):boolean {
  if (!icase) return word.startsWith(input)
  return word.toLowerCase().startsWith(input.toLowerCase())
}

function getValidPort(port:number, cb:(port:number)=>void):void {
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

export function getPort(port = 44877):Promise<number> {
  return new Promise(resolve => {
    getValidPort(port, result => {
      resolve(result)
    })
  })
}

// -1 is cancel
export async function showQuickpick(nvim:Neovim, items:string[], placeholder = 'Choose by number'):Promise<number> {
  let msgs = [placeholder + ':']
  msgs = msgs.concat(items.map((str, index) => {
    return `${index + 1}) ${str}`
  }))
  let res = await nvim.call('input', [msgs.join('\n') + '\n'])
  let n = parseInt(res, 10)
  if (isNaN(n) || n <=0 || n > res.length) return -1
  return n - 1
}

export function disposeAll(disposables: Disposable[]):void {
  while (disposables.length) {
    const item = disposables.pop()
    if (item) {
      item.dispose()
    }
  }
}

export function getChangeEvent(doc:TextDocument, text:string):TextDocumentContentChangeEvent {
  let orig = doc.getText()
  if (!orig.length) return {text}
  let start = -1
  let isAdd = text.length > orig.length
  let end = orig.length
  let changedText = ''
  for (let i = 0, l = orig.length; i < l; i++) {
    if (orig[i] !== text[i]) {
      start = i
      break
    }
  }
  if (start != -1) {
    let cl = text.length
    let n = 1
    for (let i = end - 1; i >= 0; i--) {
      let j = cl - n
      if (isAdd && i == start) {
        end = start
        changedText = text.slice(start, j)
        break
      }
      if (!isAdd && j == start) {
        end = i
        break
      }
      if (orig[i] !== text[j]) {
        end = i + 1
        changedText = text.slice(start, end)
        break
      }
      n++
    }
  } else {
    start = 0
    changedText = text.slice(end)
  }
  logger.debug('position: ', start, end, changedText.length)
  return {
    range: {
      start: doc.positionAt(start),
      end: doc.positionAt(end),
    },
    rangeLength: end - start,
    text: changedText
  }
}
