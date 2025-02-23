'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { createLogger } from '../logger'
import { KeymapOption } from '../types'
import { Disposable } from '../util/protocol'
import { toBase64 } from '../util/string'
const logger = createLogger('core-keymaps')

export type MapMode = 'n' | 'i' | 'v' | 'x' | 's' | 'o' | '!'
export type LocalMode = 'n' | 'i' | 'v' | 's' | 'x'

export function getKeymapModifier(mode: MapMode): string {
  if (mode == 'n' || mode == 'o' || mode == 'x' || mode == 'v') return '<C-U>'
  if (mode == 'i') return '<C-o>'
  if (mode == 's') return '<Esc>'
  return ''
}

export function getBufnr(buffer: number | boolean): number {
  return typeof buffer === 'number' ? buffer : events.bufnr
}

export default class Keymaps {
  private readonly keymaps: Map<string, [Function, boolean]> = new Map()
  private nvim: Neovim

  public attach(nvim: Neovim): void {
    this.nvim = nvim
  }

  public async doKeymap(key: string, defaultReturn: string): Promise<string> {
    let keymap = this.keymaps.get(key) ?? this.keymaps.get('coc-' + key)
    if (!keymap) {
      logger.error(`keymap for ${key} not found`)
      return defaultReturn
    }
    let [fn, repeat] = keymap
    let res = await Promise.resolve(fn())
    if (repeat) await this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`)
    return res ?? defaultReturn
  }

  /**
   * Register global <Plug>(coc-${key}) key mapping.
   */
  public registerKeymap(modes: MapMode[], name: string, fn: Function, opts: Partial<KeymapOption> = {}): Disposable {
    if (!name) throw new Error(`Invalid key ${name} of registerKeymap`)
    let key = `coc-${name}`
    if (this.keymaps.has(key)) throw new Error(`${name} already exists.`)
    let lhs = `<Plug>(${key})`
    opts = Object.assign({ sync: true, cancel: true, silent: true, repeat: false }, opts)
    let { nvim } = this
    this.keymaps.set(key, [fn, !!opts.repeat])
    let method = opts.sync ? 'request' : 'notify'
    let cancel = opts.cancel ? 1 : 0
    for (let mode of modes) {
      if (mode == 'i') {
        nvim.setKeymap(mode, lhs, `coc#_insert_key('${method}', '${key}', ${cancel})`, {
          expr: true,
          noremap: true,
          silent: opts.silent
        })
      } else {
        nvim.setKeymap(mode, lhs, `:${getKeymapModifier(mode)}call coc#rpc#${method}('doKeymap', ['${key}'])<cr>`, {
          noremap: true,
          silent: opts.silent
        })
      }
    }
    return Disposable.create(() => {
      this.keymaps.delete(key)
      for (let m of modes) {
        nvim.deleteKeymap(m, lhs)
      }
    })
  }

  public registerExprKeymap(mode: MapMode, lhs: string, fn: Function, buffer: number | boolean = false, cancel = true): Disposable {
    let bufnr = getBufnr(buffer)
    let id = `${mode}-${toBase64(lhs)}${buffer ? `-${bufnr}` : ''}`
    let { nvim } = this
    let rhs: string
    if (mode == 'i') {
      rhs = `coc#_insert_key('request', '${id}', ${cancel ? '1' : '0'})`
    } else {
      rhs = `coc#rpc#request('doKeymap', ['${id}'])`
    }
    let opts = { noremap: true, silent: true, expr: true, nowait: true }
    if (buffer) {
      nvim.createBuffer(bufnr).setKeymap(mode, lhs, rhs, opts)
    } else {
      nvim.setKeymap(mode, lhs, rhs, opts)
    }
    this.keymaps.set(id, [fn, false])
    return Disposable.create(() => {
      this.keymaps.delete(id)
      if (buffer) {
        nvim.createBuffer(bufnr).deleteKeymap(mode, lhs)
      } else {
        nvim.deleteKeymap(mode, lhs)
      }
    })
  }

  public registerLocalKeymap(bufnr: number, mode: LocalMode, lhs: string, fn: Function, notify: boolean): Disposable {
    let { nvim } = this
    let buffer = nvim.createBuffer(bufnr)
    let id = `local-${bufnr}-${mode}-${toBase64(lhs)}`
    this.keymaps.set(id, [fn, false])
    let method = notify ? 'notify' : 'request'
    let modify = getKeymapModifier(mode)
    buffer.setKeymap(mode, lhs, `:${modify}call coc#rpc#${method}('doKeymap', ['${id}'])<CR>`, {
      silent: true,
      nowait: true,
      noremap: true
    })
    return Disposable.create(() => {
      this.keymaps.delete(id)
      buffer.deleteKeymap(mode, lhs)
    })
  }
}
