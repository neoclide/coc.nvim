import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private _content = ''
  private disposables: Disposable[] = []
  private _showing = false
  private promise = Promise.resolve(void 0)
  constructor(public name: string, private nvim: Neovim) {
  }

  public get content(): string {
    return this._content
  }

  private async _append(value: string, isLine: boolean): Promise<void> {
    let { buffer } = this
    if (!buffer) return
    try {
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
    } catch (e) {
      logger.error(`Error on append output:`, e)
    }
  }

  public append(value: string): void {
    this._content += value
    this.promise = this.promise.then(() => {
      return this._append(value, false)
    })
  }

  public appendLine(value: string): void {
    this._content += value + '\n'
    this.promise = this.promise.then(() => {
      return this._append(value, true)
    })
  }

  public clear(): void {
    this._content = ''
    let { buffer } = this
    if (buffer) {
      Promise.resolve(buffer.setLines([], {
        start: 0,
        end: -1,
        strictIndexing: false
      })).catch(_e => {
        // noop
      })
    }
  }

  public hide(): void {
    let { nvim, buffer } = this
    if (buffer) nvim.command(`silent! bd! ${buffer.id}`, true)
  }

  public dispose(): void {
    this.hide()
    this._content = ''
    disposeAll(this.disposables)
  }

  private get buffer(): Buffer | null {
    let doc = workspace.getDocument(`output:///${this.name}`)
    return doc ? doc.buffer : null
  }

  private async openBuffer(preserveFocus?: boolean): Promise<void> {
    let { nvim, buffer } = this
    if (buffer) {
      let loaded = await nvim.call('bufloaded', buffer.id)
      if (!loaded) buffer = null
    }
    if (!buffer) {
      await nvim.command(`belowright vs output:///${this.name}`)
    } else {
      // check shown
      let wnr = await nvim.call('bufwinnr', buffer.id)
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
