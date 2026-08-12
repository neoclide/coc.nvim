import type { Buffer, Neovim } from '@chemzqm/neovim'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import { CancellationTokenSource, type Disposable } from 'vscode-languageserver-protocol'
import { getCurrentPlugin } from '../attach'
import completion from '../completion'
import type { DurationCompleteItem } from '../completion/types'
import events from '../events'
import type Document from '../model/document'
import type { ProviderResult } from '../provider'
import type { OutputChannel } from '../types'
import workspace from '../workspace'

const testsRoot = import.meta.dirname

/**
 * The live nvim instance of the current editor test session. Editor workers
 * start their session before loading test modules, so the plugin wiring that
 * defines `workspace.nvim` is already in place when this module evaluates.
 */
export const nvim: Neovim = workspace.nvim
if (!nvim) {
  throw new Error('sharedUtil: editor session must be started before test modules load')
}

export function wait(ms = 30): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function waitValue<T>(fn: () => ProviderResult<T>, value: T): Promise<void> {
  let find = false
  for (let i = 0; i < 200; i++) {
    // Let pending I/O and promise continuations settle before the first
    // check without paying a fixed 20ms for values that are already ready.
    // Keep the existing polling interval after a miss to avoid a busy loop.
    if (i === 0) await new Promise(resolve => setImmediate(resolve))
    else await wait(20)
    let res = await Promise.resolve(fn())
    // A single event-loop turn can expose an intermediate editor state.
    // Confirm an immediately-ready value once more before returning; a
    // changed value falls back to the established 20ms polling cadence.
    if (i === 0 && util.isDeepStrictEqual(res, value)) {
      await new Promise(resolve => setImmediate(resolve))
      res = await Promise.resolve(fn())
    }
    if (util.isDeepStrictEqual(res, value)) {
      find = true
      break
    }
  }
  if (!find) {
    throw new Error(`waitValue ${value} timeout`)
  }
}

export async function waitFor<T>(method: string, args: any[], value: T): Promise<void> {
  let find = false
  let res: T
  const { nvim } = workspace
  for (let i = 0; i < 100; i++) {
    if (i === 0) await new Promise(resolve => setImmediate(resolve))
    else await wait(20)
    res = await nvim.call(method, args) as T
    let matched = util.isDeepStrictEqual(res, value) || (value instanceof RegExp && value.test(res.toString()))
    if (i === 0 && matched) {
      await new Promise(resolve => setImmediate(resolve))
      res = await nvim.call(method, args) as T
      matched = util.isDeepStrictEqual(res, value) || (value instanceof RegExp && value.test(res.toString()))
    }
    if (matched) {
      find = true
      break
    }
  }
  if (!find) {
    throw new Error(`waitFor ${value} timeout, current: ${res}`)
  }
}

export async function waitNotification(event: string): Promise<void> {
  const { nvim } = workspace
  return new Promise((resolve, reject) => {
    let fn = (method: string) => {
      if (method == event) {
        clearTimeout(timer)
        nvim.removeListener('notification', fn)
        resolve()
      }
    }
    let timer = setTimeout(() => {
      nvim.removeListener('notification', fn)
      reject(new Error('wait notification timeout after 2s'))
    }, 2000)
    nvim.on('notification', fn)
  })
}

export async function waitPrompt(): Promise<void> {
  const { nvim } = workspace
  if (await nvim.call('coc#prompt#activated')) return
  for (let i = 0; i < 60; i++) {
    await wait(30)
    let prompt = await nvim.call('coc#prompt#activated')
    if (prompt) return
  }
  throw new Error('Wait prompt timeout after 2s')
}

export async function waitPromptWin(): Promise<number> {
  const { nvim } = workspace
  let winid = await nvim.call('coc#dialog#get_prompt_win') as number
  if (winid != -1) return winid
  for (let i = 0; i < 60; i++) {
    await wait(30)
    let winid = await nvim.call('coc#dialog#get_prompt_win') as number
    if (winid != -1) return winid
  }
  throw new Error('Wait prompt window timeout after 2s')
}

export async function waitFloat(): Promise<number> {
  const { nvim } = workspace
  let winid = await nvim.call('GetFloatWin') as number
  if (winid) return winid
  for (let i = 0; i < 50; i++) {
    await wait(20)
    let winid = await nvim.call('GetFloatWin') as number
    if (winid) return winid
  }
  throw new Error('timeout after 2s')
}

export async function waitPopup(): Promise<void> {
  const tokenSource = new CancellationTokenSource()
  const timer = setTimeout(() => tokenSource.cancel(), 8000)
  try {
    while (true) {
      // Subscribe before checking the current state so a MenuPopupChanged
      // notification cannot be lost between the check and listener setup.
      const changed = events.race(['MenuPopupChanged'], tokenSource.token)
      if (await workspace.nvim.call('coc#pum#visible', []) === 1) return
      if (!await changed) throw new Error('wait pum timeout after 8s')
    }
  } finally {
    clearTimeout(timer)
    tokenSource.cancel()
    tokenSource.dispose()
  }
}

export async function doAction(method: string, ...args: any[]): Promise<any> {
  return await getCurrentPlugin().cocAction(method, ...args)
}

export async function items(): Promise<DurationCompleteItem[]> {
  return completion.activeItems.slice()
}

export async function confirmCompletion(idx: number): Promise<void> {
  await workspace.nvim.call('coc#pum#select', [idx, 1, 1])
}

export async function visible(word: string, source?: string): Promise<boolean> {
  await waitPopup()
  let items = completion.activeItems
  if (!items) return false
  let item = items.find(o => o.word == word)
  if (!item) return false
  if (source && item.source.name != source) return false
  return true
}

export async function edit(file?: string): Promise<Buffer> {
  const { nvim } = workspace
  if (!file || !path.isAbsolute(file)) {
    file = path.join(testsRoot, file ? file : `${crypto.randomUUID()}`)
  }
  let escaped = await nvim.call('fnameescape', file) as string
  await nvim.command(`edit ${escaped}`)
  let doc = await workspace.document
  return doc.buffer
}

export async function createDocument(name?: string): Promise<Document> {
  let buf = await edit(name)
  let doc = workspace.getDocument(buf.id)
  if (!doc) return await workspace.document
  return doc
}

export async function listInput(input: string): Promise<void> {
  await events.fire('InputChar', ['list', input, 0])
}

export async function getCmdline(lnum?: number): Promise<string> {
  const { nvim } = workspace
  let str = ''
  let n = await nvim.eval('&lines') as number
  for (let i = 1, l = 70; i < l; i++) {
    let ch = await nvim.call('screenchar', [lnum ?? n - 1, i]) as number
    if (ch == -1) break
    str += String.fromCharCode(ch)
  }
  return str.trim()
}

export function updateConfiguration(key: string, value: any, disposables?: Disposable[]): () => void {
  let curr = workspace.getConfiguration(key)
  let { configurations } = workspace
  configurations.updateMemoryConfig({ [key]: value })
  let fn = () => {
    configurations.updateMemoryConfig({ [key]: curr })
  }
  if (disposables) disposables.push({ dispose: fn })
  return fn
}

export async function getMatches(hlGroup: string): Promise<any[]> {
  let res = await workspace.nvim.call('getmatches') as any[]
  let list = []
  res.forEach(o => {
    if (o.group === hlGroup) {
      for (const [key, value] of Object.entries(o)) {
        if (key.startsWith('pos')) {
          list.push(value)
        }
      }
    }
  })
  return list
}

export async function mockFunction(name: string, result: any): Promise<void> {
  let content = `
    function! ${name}(...)
      return ${typeof result == 'number' ? result : JSON.stringify(result)}
    endfunction`
  await workspace.nvim.exec(content)
}

export async function getFloat(kind?: string): Promise<any> {
  const { nvim } = workspace
  if (!kind) {
    let ids = await nvim.call('coc#float#get_float_win_list') as number[]
    return ids.length ? nvim.createWindow(ids[0]) : undefined
  }
  let id = await nvim.call('coc#float#get_float_by_kind', [kind]) as number
  return id ? nvim.createWindow(id) : undefined
}

export async function getWinLines(winid: number): Promise<string[]> {
  return await workspace.nvim.eval(`getbufline(winbufnr(${winid}), 1, '$')`) as string[]
}

export function createNullChannel(): OutputChannel {
  return {
    content: '',
    show: () => {},
    dispose: () => {},
    name: 'null',
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    hide: () => {}
  }
}

export async function createTmpFile(content: string, disposables?: Disposable[]): Promise<string> {
  let tmpFolder = path.join(process.env.COC_DATA_HOME ?? os.tmpdir(), 'tmp')
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let fsPath = path.join(tmpFolder, crypto.randomUUID())
  await util.promisify(fs.writeFile)(fsPath, content, 'utf8')
  if (disposables) {
    disposables.push({
      dispose: () => {
        if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath)
      }
    })
  }
  return fsPath
}
