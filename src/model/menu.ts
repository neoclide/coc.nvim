import { Event, Emitter } from 'vscode-languageserver-protocol'
import { Neovim, Window } from '@chemzqm/neovim'
import FloatFactory from './floatFactory'
import { Env } from '../types'
import events from '../events'
const logger = require('../util/logger')('model-menu')

export default class Menu {
  private floatFactory: FloatFactory
  private _onDidChoose = new Emitter<number>()
  private _onDidCancel = new Emitter<void>()
  private currIndex = 0
  private total = 0
  private srcId: number
  public readonly onDidChoose: Event<number> = this._onDidChoose.event
  public readonly onDidCancel: Event<void> = this._onDidCancel.event
  constructor(private nvim: Neovim, private env: Env) {
    let floatFactory = this.floatFactory = new FloatFactory(
      nvim, env, false, 20, 160, false)
    floatFactory.on('show', () => {
      this.doHighlight(0)
      choosed = undefined
    })
    floatFactory.on('close', () => {
      firstNumber = undefined
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
    events.on('MenuInput', (character, mode) => {
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
    let { nvim, srcId } = this
    if (this.env.isVim) return
    let buf = this.floatFactory.buffer
    if (!buf) return
    buf.clearNamespace(this.srcId, 0, -1)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    buf.addHighlight({
      srcId: this.srcId,
      line: index,
      colStart: 0,
      colEnd: -1,
      hlGroup: 'CocMenuSel'
    })
  }

  public async show(items: string[], title?: string): Promise<void> {
    let lines = items.map((v, i) => {
      if (i < 99) return `${i + 1}. ${v}`
      return v
    })
    lines = await this.normalizeLines(lines)
    if (!this.env.isVim) {
      this.srcId = await this.nvim.createNamespace('coc-menu')
    }
    this.total = lines.length
    this.currIndex = 0
    this.floatFactory.show([{
      content: lines.join('\n'),
      filetype: 'menu'
    }], { title, cursorline: this.env.isVim }).then(() => {
      if (this.window) {
        this.nvim.call('coc#list#start_prompt', ['MenuInput'], true)
      } else {
        // failed to create window
        this._onDidCancel.fire()
      }
    }, e => {
      logger.error(e)
    })
  }

  public hide(): void {
    this.nvim.call('coc#list#stop_prompt', [], true)
    this.floatFactory.close()
  }

  private async normalizeLines(lines: string[]): Promise<string[]> {
    let { nvim } = this
    nvim.pauseNotification()
    for (let line of lines) {
      nvim.call('strwidth', [line], true)
    }
    let [vals, err] = await nvim.resumeNotification() as [number[], [string, string, number]]
    if (err) {
      logger.error(err[1])
      return lines
    }
    let result: string[] = []
    let max = Math.max(...vals)
    for (let i = 0; i < lines.length; i++) {
      result.push(lines[i] + ' '.repeat(max - vals[i]))
    }
    return result
  }
}
