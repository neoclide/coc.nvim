import { Event, Emitter } from 'vscode-languageserver-protocol'
import { Neovim, Window } from '@chemzqm/neovim'
import FloatFactory from './floatFactory'
import { Env } from '../types'
import events from '../events'
const logger = require('../util/logger')('model-menu')

export default class Menu {
  private floatFactory: FloatFactory
  private window: Window | undefined
  private _onDidChoose = new Emitter<number>()
  private _onDidCancel = new Emitter<void>()
  private currIndex = 0
  private total = 0
  public readonly onDidChoose: Event<number> = this._onDidChoose.event
  public readonly onDidCancel: Event<void> = this._onDidCancel.event
  constructor(private nvim: Neovim, private env: Env) {
    let floatFactory = this.floatFactory = new FloatFactory(
      nvim, env, false, 20, 120, false, true)
    floatFactory.on('show', winid => {
      let win = this.window = nvim.createWindow(winid)
      if (env.isVim) {
        nvim.call('popup_setoptions', [winid, { cursorline: 1, wrap: false }], true)
      } else {
        win.setOption('cursorline', true, true)
        win.notify('nvim_win_set_cursor', [[1, 1]])
      }
      nvim.command('redraw', true)
      process.nextTick(() => {
        nvim.call('coc#list#start_prompt', ['MenuInput'], true)
      })
    })
    floatFactory.on('close', () => {
      if (!this.window) return
      nvim.call('coc#list#stop_prompt', [], true)
      this.window = undefined
      this._onDidCancel.fire()
    })
    events.on('MenuInput', async (character, mode) => {
      if (mode) return
      // esc & `<C-c>`
      if (character == '\x1b' || character == '\x03' || !this.window) {
        await nvim.call('coc#list#stop_prompt', [])
        this.floatFactory.close()
        return
      }
      if (character == '\r') {
        await nvim.call('coc#list#stop_prompt', [])
        this.window = undefined
        this._onDidChoose.fire(this.currIndex)
        this.floatFactory.close()
        return
      }
      if (character >= '1' && character <= '9') {
        let n = parseInt(character, 10)
        if (isNaN(n) || n > this.total) return
        await nvim.call('coc#list#stop_prompt', [])
        this.window = undefined
        this._onDidChoose.fire(n - 1)
        this.floatFactory.close()
        return
      }
      if (character == 'j' || character == '\x0e' || character == '\t'
        || character == 'k' || character == '\x10') {
        if (character == 'j' || character == '\x0e' || character == '\t') {
          this.currIndex = this.currIndex >= this.total - 1 ? 0 : this.currIndex + 1
        } else {
          this.currIndex = this.currIndex == 0 ? this.total - 1 : this.currIndex - 1
        }
        nvim.pauseNotification()
        if (this.env.isVim) {
          nvim.call('win_execute', [this.window.id, `exe ${this.currIndex + 1}`], true)
        } else {
          nvim.command(`noa call win_gotoid(${this.window.id})`, true)
          nvim.call('cursor', [this.currIndex + 1, 1], true)
          nvim.command('noa wincmd p', true)
        }
        nvim.command('redraw', true)
        await nvim.resumeNotification()
        return
      }
    })
  }

  public show(items: string[]): void {
    let lines = items.map((v, i) => {
      return `${i + 1}. ${v}`
    })
    this.total = lines.length
    this.currIndex = 0
    this.floatFactory.create([{
      content: lines.join('\n'),
      filetype: 'menu'
    }]).logError()
  }
}
