import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
import { Mutex } from '../util/mutex'
const logger = require('../util/logger')("outpubChannel")
const MAX_STRING_LENGTH: number = require('buffer').constants.MAX_STRING_LENGTH

export default class BufferChannel implements OutputChannel {
  private mutex = new Mutex()
  private _disposed = false
  private _content = ''
  private disposables: Disposable[] = []
  private _showing = false
  constructor(public name: string, private nvim: Neovim) {
  }

  public get content(): string {
    return this._content
  }

  private async _append(value: string): Promise<void> {
    if (!this.validate()) return
    let release = await this.mutex.acquire()
    try {
      let buf = await this.buffer
      if (buf) {
        let line = await this.nvim.call('getbufline', [buf.id, '$'])
        let lines = value.split('\n')
        await buf.setLines([line + lines[0], ...lines.slice(1)], {
          start: -2,
          end: -1,
          strictIndexing: false
        })
      }
      release()
    } catch (e) {
      release()
    }
  }

  public append(value: string): void {
    if (this._content.length + value.length >= MAX_STRING_LENGTH) {
      this.clear(10)
    }
    this._content += value
    this._append(value).logError()
  }

  public appendLine(value: string): void {
    if (this._content.length + value.length >= MAX_STRING_LENGTH) {
      this.clear(10)
    }
    this._content += value + '\n'
    this._append(value + '\n').logError()
  }

  public clear(keep?: number): void {
    if (!this.validate()) return
    let latest = []
    if (keep) latest = this._content.split('\n').slice(-keep)
    this._content = latest.join('\n')
    this.buffer.then(buf => {
      if (buf) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        buf.setLines(latest, {
          start: 0,
          end: -1,
          strictIndexing: false
        })
      }
    }).logError()
  }

  public hide(): void {
    this.nvim.command(`silent! bd! output:///${this.name}`, true)
  }

  private get buffer(): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      this.nvim.call('bufnr', [`output:///${this.name}`]).then(res => {
        if (res == -1) return resolve(null)
        resolve(this.nvim.createBuffer(res))
      }, reject)
    })
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let { nvim } = this
    let winid = await nvim.call('win_getid')
    nvim.pauseNotification()
    nvim.command(`tab drop output:///${this.name}`, true)
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
    this._content = ''
    disposeAll(this.disposables)
  }
}
