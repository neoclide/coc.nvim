'use strict'
import { Neovim, KeymapOption as VimKeymapOption } from '@chemzqm/neovim'
import { createLogger } from '../logger'
import { KeymapOption } from '../types'
import { isVim } from '../util/constants'
import { Disposable } from '../util/protocol'
import { toBase64 } from '../util/string'
const logger = createLogger('core-keymaps')

export type MapMode = 'n' | 'i' | 'v' | 'x' | 's' | 'o' | '!' | 't' | 'c' | 'l'
export type LocalMode = 'n' | 'i' | 'v' | 's' | 'x'
export type KeymapCallback = () => Promise<string> | string | void | Promise<void>

export function getKeymapModifier(mode: MapMode, cmd?: boolean): string {
  if (cmd) return '<Cmd>'
  if (mode == 'n' || mode == 'o' || mode == 'x' || mode == 'v') return '<C-U>'
  if (mode == 'i') return '<C-o>'
  if (mode == 's') return '<Esc>'
  return '<Cmd>'
}

export function getBufnr(buffer: number | boolean): number {
  return typeof buffer === 'number' ? buffer : 0
}

export default class Keymaps {
  private readonly keymaps: Map<string, [KeymapCallback, boolean]> = new Map()
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
    if (res == null) return defaultReturn
    return res as string
  }

  /**
   * Register global <Plug>(coc-${key}) key mapping.
   */
  public registerKeymap(modes: MapMode[], name: string, fn: KeymapCallback, opts: KeymapOption = {}): Disposable {
    if (!name) throw new Error(`Invalid key ${name} of registerKeymap`)
    let key = `coc-${name}`
    if (this.keymaps.has(key)) throw new Error(`keymap: "${name}" already exists.`)
    const lhs = `<Plug>(${key})`
    opts = Object.assign({ sync: true, cancel: true, silent: true, repeat: false }, opts)
    let { nvim } = this
    this.keymaps.set(key, [fn, !!opts.repeat])
    let method = opts.sync ? 'request' : 'notify'
    for (let mode of modes) {
      if (mode == 'i') {
        const cancel = opts.cancel ? 1 : 0
        nvim.setKeymap(mode, lhs, `coc#_insert_key('${method}', '${key}', ${cancel})`, {
          expr: true,
          noremap: true,
          silent: opts.silent
        })
      } else {
        nvim.setKeymap(mode, lhs, `:${getKeymapModifier(mode, opts.cmd)}call coc#rpc#${method}('doKeymap', ['${key}'])<cr>`, {
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

  public registerExprKeymap(mode: MapMode, lhs: string, fn: KeymapCallback, buffer: number | boolean = false, cancel = true): Disposable {
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
    if (buffer !== false) {
      nvim.call('coc#compat#buf_add_keymap', [bufnr, mode, lhs, rhs, opts], true)
    } else {
      nvim.setKeymap(mode, lhs, rhs, opts)
    }
    this.keymaps.set(id, [fn, false])
    return Disposable.create(() => {
      this.keymaps.delete(id)
      if (buffer) {
        nvim.call('coc#compat#buf_del_keymap', [bufnr, mode, lhs], true)
      } else {
        nvim.deleteKeymap(mode, lhs)
      }
    })
  }

  public registerLocalKeymap(bufnr: number, mode: LocalMode, lhs: string, fn: KeymapCallback, option: boolean | KeymapOption): Disposable {
    let { nvim } = this
    let buffer = nvim.createBuffer(bufnr)
    let id = `local-${bufnr}-${mode}-${toBase64(lhs)}`
    const opts = toKeymapOption(option)
    this.keymaps.set(id, [fn, !!opts.repeat])
    const method = opts.sync ? 'request' : 'notify'
    const opt: VimKeymapOption = { noremap: true, silent: opts.silent !== false }
    if (isVim && opts.special) opt.special = true
    if (mode == 'i') {
      const cancel = opts.cancel ? 1 : 0
      opt.expr = true
      buffer.setKeymap(mode, lhs, `coc#_insert_key('${method}', '${id}', ${cancel})`, opt)
    } else {
      opt.nowait = true
      const modify = getKeymapModifier(mode, opts.cmd)
      buffer.setKeymap(mode, lhs, `:${modify}call coc#rpc#${method}('doKeymap', ['${id}'])<CR>`, opt)
    }
    return Disposable.create(() => {
      this.keymaps.delete(id)
      buffer.deleteKeymap(mode, lhs)
    })
  }
}

function toKeymapOption(option: KeymapOption | boolean): KeymapOption {
  const conf = typeof option == 'boolean' ? { sync: !option } : option
  return Object.assign({ sync: true, cancel: true, silent: true }, conf)
}
