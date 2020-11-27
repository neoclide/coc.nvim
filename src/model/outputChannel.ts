import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private _disposed = false
  private _showing = false
  private lines: string[] = ['']
  private disposables: Disposable[] = []
  constructor(public name: string, private nvim: Neovim) {
  }

  public get content(): string {
    return this.lines.join('\n')
  }

  private _append(value: string): void {
    let { nvim } = this
    let idx = this.lines.length - 1
    let newlines = value.split('\n')
    let lastline = this.lines[idx] + newlines[0]
    this.lines[idx] = lastline
    let append = newlines.slice(1)
    this.lines = this.lines.concat(append)
    nvim.pauseNotification()
    nvim.call('setbufline', [this.bufname, '$', lastline], true)
    if (append.length) {
      nvim.call('appendbufline', [this.bufname, '$', append], true)
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  public append(value: string): void {
    if (!this.validate()) return
    this._append(value)
  }

  public appendLine(value: string): void {
    if (!this.validate()) return
    this._append(value + '\n')
  }

  public clear(keep?: number): void {
    if (!this.validate()) return
    let { nvim } = this
    this.lines = keep ? this.lines.slice(-keep) : []
    nvim.pauseNotification()
    nvim.call('deletebufline', [this.bufname, 1, '$'], true)
    if (this.lines.length) {
      nvim.call('appendbufline', [this.bufname, '$', this.lines], true)
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  public hide(): void {
    this.nvim.command(`silent! bd! ${this.bufname}`, true)
  }

  private get bufname(): string {
    return `output:///${this.name}`
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let { nvim } = this
    let winid = await nvim.call('win_getid')
    nvim.pauseNotification()
    const escapedName = await nvim.call('fnameescape', this.name)
    nvim.command(`tab drop output:///${escapedName}`, true)
    if (preserveFocus) {
      nvim.call('win_gotoid', [winid], true)
    }
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  public show(preserveFocus?: boolean): void {
    if (this._showing) return
    this._showing = true
    this.openBuffer(preserveFocus).then(() => {
      this._showing = false
    }, () => {
      this._showing = false
    })
  }

  private validate(): boolean {
    if (this._disposed) return false
    return true
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.hide()
    this.lines = []
    disposeAll(this.disposables)
  }
}
