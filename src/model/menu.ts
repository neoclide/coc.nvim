import { Event, Emitter } from 'vscode-languageserver-protocol'
import { Neovim, Window } from '@chemzqm/neovim'
import FloatFactory, { FloatWinConfig } from './floatFactory'
import { Env } from '../types'
import events from '../events'
import { DialogPreferences } from '..'
const logger = require('../util/logger')('model-menu')

export default class Menu {
  private floatFactory: FloatFactory
  private _onDidChoose = new Emitter<number>()
  private _onDidCancel = new Emitter<void>()
  private currIndex = 0
  private total = 0
  public readonly onDidChoose: Event<number> = this._onDidChoose.event
  public readonly onDidCancel: Event<void> = this._onDidCancel.event
  constructor(private nvim: Neovim, private env: Env) {
    let floatFactory = this.floatFactory = new FloatFactory(
      nvim, env, false, 20, 80, false)
    floatFactory.on('show', () => {
      this.doHighlight(0)
      choosed = undefined
    })
    floatFactory.on('close', () => {
      firstNumber = undefined
      nvim.call('coc#prompt#stop_prompt', ['menu'], true)
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
    events.on('InputChar', (scope, character, mode) => {
      if (mode || scope !== 'menu') return
      if (timer) clearTimeout(timer)
      // esc & `<C-c>`
      if (character == '<esc>' || character == '<C-c>' || !this.window) {
        this.hide()
        return
      }
      if (character == '\r' || character == '<cr>') {
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
      } else if (['j', '<tab>', '<down>', '<C-n>'].includes(character)) {
        this.currIndex = this.currIndex >= this.total - 1 ? 0 : this.currIndex + 1
      } else if (['k', '<up>', '<s-tab>', '<C-p>'].includes(character)) {
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
        this.doHighlight(this.currIndex)
        nvim.command('noa wincmd p', true)
      }
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    })
  }

  public get window(): Window {
    return this.floatFactory.window
  }

  private doHighlight(index: number): void {
    let { nvim } = this
    if (this.env.isVim) return
    let buf = this.floatFactory.buffer
    if (!buf) return
    nvim.command(`sign unplace 6 buffer=${buf.id}`, true)
    nvim.command(`sign place 6 line=${index + 1} name=CocCurrentLine buffer=${buf.id}`, true)
  }

  public show(items: string[], title?: string, preferences: DialogPreferences = {}): void {
    let lines = items.map((v, i) => {
      if (i < 99) return `${i + 1}. ${v}`
      return v
    })
    this.total = lines.length
    this.currIndex = 0
    let opts: FloatWinConfig = { title, cursorline: this.env.isVim }
    opts.maxWidth = preferences.maxWidth
    opts.maxHeight = preferences.maxHeight
    opts.highlight = preferences.floatHighlight
    opts.borderhighlight = preferences.floatBorderHighlight
    this.floatFactory.show([{ content: lines.join('\n'), filetype: 'menu' }], opts).then(() => {
      if (this.window) {
        this.nvim.call('coc#prompt#start_prompt', ['menu'], true)
      } else {
        // failed to create window
        this._onDidCancel.fire()
      }
    }, e => {
      logger.error(e)
    })
  }

  public hide(): void {
    this.nvim.call('coc#prompt#stop_prompt', ['menu'], true)
    this.floatFactory.close()
  }
}
