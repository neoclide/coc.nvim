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
      choosed = undefined
      this.currIndex = 0
      let win = this.window = nvim.createWindow(winid)
      if (env.isVim) {
        nvim.call('popup_setoptions', [winid, { cursorline: 1, wrap: false }], true)
      } else {
        win.notify('nvim_win_set_cursor', [[1, 1]])
      }
      nvim.command('redraw', true)
      process.nextTick(() => {
        nvim.call('coc#list#start_prompt', ['MenuInput'], true)
      })
    })
    floatFactory.on('close', () => {
      firstNumber = undefined
      this.window = undefined
      nvim.call('coc#list#stop_prompt', [], true)
      if (choosed != null && choosed < this.total) {
        this._onDidChoose.fire(choosed)
        choosed = undefined
      } else {
        this._onDidCancel.fire()
      }
    })
    let timer: NodeJS.Timeout
    let firstNumber: number
    let choosed: number
    events.on('MenuInput', async (character, mode) => {
      if (mode) return
      if (timer) clearTimeout(timer)
      // esc & `<C-c>`
      if (character == '\x1b' || character == '\x03' || !this.window) {
        this.hide()
        return
      }
      if (character == '\r') {
        choosed = this.currIndex
        this.hide()
        return
      }
      if (character >= '0' && character <= '9') {
        let n = parseInt(character, 10)
        if (isNaN(n) || n > this.total) return
        if (firstNumber == null && n == 0) return
        if (firstNumber) {
          let count = firstNumber * 10 + n
          firstNumber = undefined
          choosed = count - 1
          this.hide()
          return
        }
        if (this.total < 10 || n * 10 > this.total) {
          choosed = n - 1
          this.hide()
          return
        }
        timer = setTimeout(async () => {
          choosed = n - 1
          this.hide()
          firstNumber = undefined
        }, 200)
        firstNumber = n
        return
      }
      firstNumber = undefined
      if (character == 'G') {
        this.currIndex = this.total - 1
      } else if (['j', '\x0e', '\t'].includes(character)) {
        this.currIndex = this.currIndex >= this.total - 1 ? 0 : this.currIndex + 1
      } else if (['k', '\x10'].includes(character)) {
        this.currIndex = this.currIndex == 0 ? this.total - 1 : this.currIndex - 1
      } else {
        return
      }
      nvim.pauseNotification()
      if (this.env.isVim) {
        nvim.call('win_execute', [this.window.id, `exe ${this.currIndex + 1}`], true)
      } else {
        nvim.call('coc#util#win_gotoid', [this.window.id], true)
        nvim.call('cursor', [this.currIndex + 1, 1], true)
        nvim.command('noa wincmd p', true)
      }
      nvim.command('redraw', true)
      await nvim.resumeNotification()
    })
  }

  public show(items: string[], title?: string): void {
    let lines = items.map((v, i) => {
      if (i < 19) return `${i + 1}. ${v}`
      return v
    })
    this.total = lines.length
    this.floatFactory.show([{
      content: lines.join('\n'),
      filetype: 'menu'
    }], { title }).logError()
  }

  public hide(): void {
    this.nvim.call('coc#list#stop_prompt', [], true)
    this.window = undefined
    this.floatFactory.close()
  }
}
