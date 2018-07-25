import {OutputChannel} from '../types'
import {Neovim, Buffer} from '@chemzqm/neovim'
import workspace from '../workspace'
import {Disposable} from 'vscode-languageserver-protocol'
import {disposeAll} from '../util'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private buffer:Buffer = null
  private content = ''
  private disposables:Disposable[] = []
  private _showing = false
  constructor(public name:string, private nvim:Neovim) {
    let {emitter} = workspace
    let onUnload = this.onUnload.bind(this)
    emitter.on('BufUnload', onUnload)
    this.disposables.push(Disposable.create(() => {
      emitter.removeListener('BufUnload', onUnload)
    }))
  }

  private async isShown():Promise<boolean> {
    let {nvim, name} = this
    let exists = await nvim.call('bufexists', [`[coc ${name}]`])
    if (!exists && this.buffer) {
      this.buffer = null
    }
    return exists == 1
  }

  private onUnload(bufnr:number):void {
    let {buffer} = this
    if (buffer && buffer.id == bufnr) {
      this.buffer = null
    }
  }

  public append(value: string): void {
    this.content += value
    let {buffer} = this
    if (!buffer) return
    let lines = this.content.split('\n')
    buffer.setLines(lines.slice(-1), {
      start: -2,
      end: -1,
      strictIndexing: false
    }).catch(e => {
      logger.error(e.message)
    })
  }

  public appendLine(value: string): void {
    let newLines = value.split('\n')
    this.content += `${value}\n`
    let {buffer} = this
    if (!buffer) return
    buffer.append(newLines).catch(e => {
      logger.error(e.message)
    })
  }

  public clear(): void {
    this.content = ''
    if (this.buffer) {
      this.buffer.setLines([], {
        start: 1,
        end: -1,
        strictIndexing: false
      }).catch(_e => {
        // noop
      })
    }
  }

  public show(preserveFocus?:boolean): void {
    if (this._showing) return
    this._showing = true
    this.isShown().then(shown => {
      if (!shown) {
        return this.openBuffer(preserveFocus)
      }
    }).finally(() => {
      this._showing = false
    })
  }

  public hide(): void {
    let {buffer, nvim} = this
    if (!buffer) return
    this.buffer = null
    nvim.command(`slient! bd! ${buffer.id}`)
  }

  public dispose(): void {
    this.hide()
    this.buffer = null
    disposeAll(this.disposables)
  }

  private async openBuffer(preserveFocus?:boolean):Promise<void> {
    let {buffer, nvim, content} = this
    if (!buffer) {
      await nvim.command(`belowright vs +setl\\ buftype=nofile [coc ${this.name}]`)
      await nvim.command('setl bufhidden=hide')
      buffer = this.buffer = await nvim.buffer
    }
    await buffer.setLines(content.split('\n'), {
      start: 1,
      end: -1,
      strictIndexing: false
    })
    if (preserveFocus) {
      await this.nvim.command('wincmd p')
    }
  }
}
