import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private content = ''
  private disposables: Disposable[] = []
  private _showing = false
  private promise = Promise.resolve(void 0)
  private bufnr: number | null = null
  constructor(public name: string, private nvim: Neovim) {
  }

  private get buffer(): Buffer {
    if (!this.bufnr) return null
    let doc = workspace.getDocument(this.bufnr)
    return doc ? doc.buffer : null
  }

  private async _append(value: string, isLine: boolean): Promise<void> {
    let { buffer } = this
    if (!buffer) return
    if (isLine) {
      await buffer.append(value.split('\n'))
    } else {
      let last = await this.nvim.call('getbufline', [buffer.id, '$'])
      let content = last + value
      if (this.buffer) {
        await buffer.setLines(content.split('\n'), {
          start: -2,
          end: -1,
          strictIndexing: false
        })
      }
    }
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
    let { buffer } = this
    if (buffer) {
      buffer.setLines([], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
    }
  }

  public hide(): void {
    let { nvim } = this
    let { buffer } = this
    if (buffer) nvim.command(`silent! bd! ${buffer.id}`, true)
  }

  public dispose(): void {
    this.hide()
    this.content = ''
    disposeAll(this.disposables)
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let { nvim } = this
    if (!this.buffer) {
      await nvim.command(`noa belowright vs +setl\\ buftype=nofile\\ bufhidden=wipe [coc ${this.name}]`)
      await nvim.command('setfiletype log')
      let buffer = await nvim.buffer
      await buffer.setOption('swapfile', false)
      await buffer.setLines(this.content.split('\n'), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      this.bufnr = buffer.id
    } else {
      let wnr = await nvim.call('bufwinnr', this.bufnr)
      // is shown
      if (wnr != -1) return
      await nvim.command(`vert belowright sb ${this.bufnr}`)
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
