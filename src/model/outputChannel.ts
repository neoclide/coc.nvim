import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')('outpubChannel')

export default class BufferChannel implements OutputChannel {
  private _disposed = false
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
    let newlines = value.split(/\r?\n/)
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
    this.nvim.command(`exe 'silent! bd! '.fnameescape('${this.bufname}')`, true)
  }

  private get bufname(): string {
    return `output:///${this.name}`
  }

  public show(preserveFocus?: boolean): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command(`exe 'vsplit '.fnameescape('${this.bufname}')`, true)
    if (preserveFocus) {
      nvim.command('wincmd p', true)
    }
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
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
