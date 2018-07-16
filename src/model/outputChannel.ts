import {OutputChannel} from '../types'
import {Neovim, Buffer} from 'neovim'
import workspace from '../workspace'
import {Disposable} from 'vscode-languageserver-protocol'
import {disposeAll} from '../util'
const logger = require('../util/logger')("outpubChannel")

export default class BufferChannel implements OutputChannel {
  private shown = false
  private buffer:Buffer = null
  private content = ''
  private disposables:Disposable[] = []
  constructor(public name:string, private nvim:Neovim) {
    let {emitter} = workspace
    let onUnload = this.onUnload.bind(this)
    let onHide = this.onHide.bind(this)
    emitter.on('BufUnload', onUnload)
    emitter.on('BufHidden', onHide)
    this.disposables.push(Disposable.create(() => {
      emitter.removeListener('BufUnload', onUnload)
      emitter.removeListener('BufHidden', onHide)
    }))
  }

  private onUnload(bufnr:number):void {
    let {buffer} = this
    if (buffer && buffer.id == bufnr) {
      this.buffer = null
      this.shown = false
    }
  }

  private onHide(bufnr:number):void {
    let {buffer} = this
    if (buffer && buffer.id == bufnr) {
      this.shown = false
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
    let {shown} = this
    if (shown) return
    this.openBuffer(preserveFocus).catch(e => {
      logger.error(e.stack)
    })
  }

  public hide(): void {
    if (!this.shown) return
    this.shown = false
    this.buffer = null
    let {buffer, nvim} = this
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
      await nvim.command('setl bufhidden=wipe')
      buffer = this.buffer = await nvim.buffer
    } else {
      await this.nvim.command(`belowright vs +b\\ ${buffer.id}`) // tslint:disable-line
    }
    await buffer.setLines(content.split('\n'), {
      start: 1,
      end: -1,
      strictIndexing: false
    })
    this.shown = true
    if (preserveFocus) {
      await this.nvim.command('wincmd p')
    }
  }
}
