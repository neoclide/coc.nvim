import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
import URI from 'vscode-uri'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private content = ''
  private disposables: Disposable[] = []
  private _showing = false
  private promise = Promise.resolve(void 0)
  private buffer: Buffer | null = null
  constructor(public name: string, private nvim: Neovim) {
    workspace.onDidCloseTextDocument(doc => {
      let p = URI.parse(doc.uri).path
      if (p.startsWith(this.bufname)) {
        this.buffer = null
      }
    }, null, this.disposables)
  }

  private get bufname(): string {
    return `[coc ${this.name}]`
  }

  private async _append(value: string, isLine: boolean): Promise<void> {
    let { buffer } = this
    if (!buffer) return
    if (isLine) {
      await buffer.append(value.split('\n'))
      return
    }
    let last = await this.nvim.call('getbufline', [buffer.id, '$'])
    let content = last + value
    await buffer.setLines(content.split('\n'), {
      start: -2,
      end: -1,
      strictIndexing: false
    })
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
      }).catch(_e => {
        // noop
      })
    }
  }

  public hide(): void {
    let { nvim } = this
    let { buffer } = this
    if (buffer) {
      nvim.command(`silent! bd! ${buffer.id}`, true)
    }
  }

  public dispose(): void {
    this.hide()
    this.content = ''
    disposeAll(this.disposables)
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let { buffer } = this
    let { nvim } = this
    if (!buffer) {
      await nvim.command(`belowright vs +setl\\ buftype=nofile\\ bufhidden=wipe [coc ${this.name}]`)
      await nvim.command('setfiletype log')
      buffer = await nvim.buffer
      await buffer.setOption('swapfile', false)
      await buffer.setLines(this.content.split('\n'), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      this.buffer = buffer
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
