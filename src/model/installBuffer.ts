import { frames } from './status'
import EventEmitter from 'events'
import { Neovim, Buffer } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
const logger = require('../util/logger')('model-installBuffer')

export enum State {
  Waiting,
  Faild,
  Progressing,
  Success,
}

export default class InstallBuffer extends EventEmitter implements Disposable {
  private statMap: Map<string, State> = new Map()
  private names: string[] = []
  private finished = false
  private interval: NodeJS.Timer

  public setExtensions(names: string[]): void {
    this.statMap.clear()
    this.names = names
    for (let name of names) {
      this.statMap.set(name, State.Waiting)
    }
  }

  public startProgress(names: string[]): void {
    for (let name of names) {
      this.statMap.set(name, State.Progressing)
    }
  }

  public finishProgress(name, succeed = true): void {
    this.statMap.set(name, succeed ? State.Success : State.Faild)
    let vals = Array.from(this.statMap.values())
    if (vals.every(v => v == State.Success || v == State.Faild)) {
      this.finished = true
    }
  }

  private getLines(): string[] {
    let lines: string[] = []
    for (let name of this.names) {
      let state = this.statMap.get(name)
      let processText = ' '
      switch (state) {
        case State.Progressing: {
          let d = new Date()
          let idx = Math.floor(d.getMilliseconds() / 100)
          processText = frames[idx]
          break
        }
        case State.Faild:
          processText = '✗'
          break
        case State.Success:
          processText = '✓'
          break
      }
      lines.push(`- ${processText} ${name}${state == State.Progressing ? ' Downloading...' : ''}`)
    }
    return lines
  }

  // draw frame
  private draw(buffer: Buffer): void {
    let first = this.finished ? 'Install finished' : 'Installing extensions...'
    let lines = [first, '', ...this.getLines()]
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
    if (this.finished && this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  public async show(nvim: Neovim): Promise<void> {
    nvim.pauseNotification()
    nvim.command('vs +enew', true)
    nvim.call('bufnr', ['%'], true)
    nvim.command('setl buftype=nofile noswapfile scrolloff=0 wrap', true)
    nvim.command('wincmd p', true)
    let res = await nvim.resumeNotification()
    let bufnr = res && res[1] == null ? res[0][1] : null
    if (!bufnr) return
    let buffer = nvim.createBuffer(bufnr)
    this.interval = setInterval(() => {
      this.draw(buffer)
    }, 100)
  }

  public dispose(): void {
    if (this.interval) {
      clearInterval(this.interval)
    }
  }
}
