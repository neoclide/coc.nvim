import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private content = ''
  private disposables: Disposable[] = []
  private _showing = false
  private promise = Promise.resolve(void 0)
  constructor(public name: string, private nvim: Neovim) {
  }

  private get bufname(): string {
    return `[coc ${this.name}]`
  }

  private async getBuffer(): Promise<Buffer> {
    let { nvim, bufname } = this
    let buffers = await nvim.buffers
    if (!buffers) return null
    for (let buf of buffers) {
      let name = await nvim.call('bufname', buf.id)
      if (name == bufname) {
        return buf
      }
    }
    return null
  }

  private async _append(value: string, isLine: boolean): Promise<void> {
    let buf = await this.getBuffer()
    if (!buf) return
    let { nvim } = this
    let content: string
    if (!isLine) {
      let last = await nvim.call('getline', '$')
      content = last + value
    } else {
      content = value
    }
    await buf.append(content.split('\n'))
  }

  public append(value: string): void {
    this.content += value
    this.promise = this.promise.then(() => {
      return this._append(value, false)
    })
  }

  public appendLine(value: string): void {
    this.content += value + '\n'
    this.promise = this.promise.then(() => {
      return this._append(value, true)
    })
  }

  public clear(): void {
    this.content = ''
    // tslint:disable-next-line:no-floating-promises
    this.getBuffer().then(buf => {
      if (buf) {
        buf.setLines([], {
          start: 1,
          end: -1,
          strictIndexing: false
        }).catch(_e => {
          // noop
        })
      }
    })
  }

  public hide(): void {
    let { nvim } = this
    // tslint:disable-next-line:no-floating-promises
    this.getBuffer().then(buf => {
      if (buf) {
        nvim.command(`silent! bd! ${buf.id}`, true)
      }
    })
  }

  public dispose(): void {
    this.hide()
    this.content = ''
    disposeAll(this.disposables)
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let buffer = await this.getBuffer()
    let { nvim, content } = this
    if (!buffer) {
      await nvim.command(`belowright vs +setl\\ buftype=nofile\\ bufhidden=wipe [coc ${this.name}]`)
      await nvim.command('setfiletype log')
      buffer = await nvim.buffer
      await buffer.setOption('swapfile', false)
      await buffer.setLines(content.split('\n'), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
    } else {
      let wnr = await nvim.call('bufwinnr', buffer.id)
      // is shown
      if (wnr != -1) return
      await nvim.command(`vert belowright sb ${buffer.id}`)
    }
    if (preserveFocus) {
      await nvim.command('wincmd p')
    }
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
}
