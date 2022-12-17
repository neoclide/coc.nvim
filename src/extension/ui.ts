'use strict'
import events from '../events'
import { frames } from '../model/status'
import { HighlightItem, OutputChannel } from '../types'
import { disposeAll, getConditionValue } from '../util'
import { debounce } from '../util/node'
import { Disposable } from '../util/protocol'
import { byteLength } from '../util/string'
import window from '../window'
import workspace from '../workspace'

const interval = getConditionValue(100, 1)

export enum State {
  Waiting,
  Failed,
  Progressing,
  Success,
}

export interface InstallUI {
  start(names: string[]): void | Promise<void>
  addMessage(name: string, msg: string, isProgress?: boolean): void
  startProgress(name: string): void
  finishProgress(name: string, succeed?: boolean): void
}

export class InstallChannel implements InstallUI {
  constructor(private isUpdate: boolean, private channel: OutputChannel) {
  }

  public start(names: string[]): void {
    this.channel.appendLine(`${this.isUpdate ? 'Updating' : 'Installing'} ${names.join(', ')}`)
  }

  public addMessage(name: string, msg: string, isProgress?: boolean): void {
    if (!isProgress) {
      this.channel.appendLine(`${name} - ${msg}`)
    }
  }

  public startProgress(name: string): void {
    this.channel.appendLine(`Start ${this.isUpdate ? 'update' : 'install'} ${name}`)
  }

  public finishProgress(name: string, succeed?: boolean): void {
    if (succeed) {
      this.channel.appendLine(`${name} ${this.isUpdate ? 'update' : 'install'} succeed!`)
    } else {
      this.channel.appendLine(`${name} ${this.isUpdate ? 'update' : 'install'} failed!`)
    }
  }
}

const debounceTime = getConditionValue(500, 10)

export class InstallBuffer implements InstallUI {
  private statMap: Map<string, State> = new Map()
  private updated: Set<string> = new Set()
  private messagesMap: Map<string, string[]> = new Map()
  private disposables: Disposable[] = []
  private names: string[] = []
  private interval: NodeJS.Timer
  public bufnr: number

  constructor(private isUpdate: boolean) {
    let floatFactory = window.createFloatFactory({ modes: ['n'] })
    this.disposables.push(floatFactory)
    let fn = debounce(async (bufnr, cursor) => {
      if (bufnr == this.bufnr) {
        let msgs = this.getMessages(cursor[0] - 1)
        let docs = msgs.length > 0 ? [{ content: msgs.join('\n'), filetype: 'txt' }] : []
        await floatFactory.show(docs)
      }
    }, debounceTime)
    this.disposables.push(Disposable.create(() => {
      fn.clear()
    }))
    events.on('CursorMoved', fn, this.disposables)
    events.on('BufUnload', bufnr => {
      if (bufnr === this.bufnr) {
        this.dispose()
      }
    }, null, this.disposables)
  }

  public async start(names: string[]): Promise<void> {
    this.statMap.clear()
    this.names = names
    for (let name of names) {
      this.statMap.set(name, State.Waiting)
    }
    await this.show()
  }

  public addMessage(name: string, msg: string): void {
    let lines = this.messagesMap.get(name) || []
    this.messagesMap.set(name, lines.concat(msg.trim().split(/\r?\n/)))
    if ((msg.startsWith('Updated to') || msg.startsWith('Installed extension'))) {
      this.updated.add(name)
    }
  }

  public startProgress(name: string): void {
    this.statMap.set(name, State.Progressing)
  }

  public finishProgress(name: string, succeed?: boolean): void {
    this.statMap.set(name, succeed ? State.Success : State.Failed)
  }

  public get remains(): number {
    let count = 0
    for (let name of this.names) {
      let stat = this.statMap.get(name)
      if (![State.Success, State.Failed].includes(stat)) {
        count = count + 1
      }
    }
    return count
  }

  private getLinesAndHighlights(start: number): { lines: string[], highlights: HighlightItem[] } {
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    for (let name of this.names) {
      let state = this.statMap.get(name)
      let processText = '*'
      let hlGroup: string | undefined
      let lnum = start + lines.length
      switch (state) {
        case State.Progressing: {
          let d = new Date()
          let idx = Math.floor(d.getMilliseconds() / 100)
          processText = frames[idx]
          hlGroup = undefined
          break
        }
        case State.Failed:
          processText = '✗'
          hlGroup = 'ErrorMsg'
          break
        case State.Success:
          processText = '✓'
          hlGroup = this.updated.has(name) ? 'MoreMsg' : 'Comment'
          break
      }
      let msgs = this.messagesMap.get(name) || []
      let pre = `- ${processText} `
      let len = byteLength(pre)
      if (hlGroup) {
        highlights.push({ hlGroup, lnum, colStart: len, colEnd: len + byteLength(name) })
      }
      lines.push(`${pre}${name} ${msgs.length ? msgs[msgs.length - 1] : ''}`)
    }
    return { lines, highlights }
  }

  public getMessages(line: number): string[] {
    let name = this.names[line - 2]
    return this.messagesMap.get(name) ?? []
  }

  public get stopped(): boolean {
    return this.interval == null
  }

  // draw frame
  public draw(): void {
    let { remains, bufnr } = this
    let { nvim } = workspace
    if (!bufnr) return
    let buffer = nvim.createBuffer(bufnr)
    let first = remains == 0 ? `${this.isUpdate ? 'Update' : 'Install'} finished` : `Installing, ${remains} remaining...`
    let { lines, highlights } = this.getLinesAndHighlights(2)
    nvim.pauseNotification()
    buffer.setLines([first, '', ...lines], { start: 0, end: -1, strictIndexing: false }, true)
    buffer.updateHighlights('coc-extensions', highlights, { priority: 99 })
    if (remains == 0 && this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    nvim.resumeNotification(true, true)
  }

  private highlight(): void {
    let { nvim } = workspace
    nvim.call('matchadd', ['CocListFgCyan', '^\\-\\s\\zs\\*'], true)
    nvim.call('matchadd', ['CocListFgGreen', '^\\-\\s\\zs✓'], true)
    nvim.call('matchadd', ['CocListFgRed', '^\\-\\s\\zs✗'], true)
  }

  private async show(): Promise<void> {
    let isSync = events.requesting === true
    let { nvim } = workspace
    nvim.pauseNotification()
    nvim.command(isSync ? 'enew' : 'vs +enew', true)
    nvim.call('bufnr', ['%'], true)
    nvim.command('setl buftype=nofile bufhidden=wipe noswapfile nobuflisted wrap undolevels=-1', true)
    if (!isSync) nvim.command('nnoremap <silent><nowait><buffer> q :q<CR>', true)
    this.highlight()
    let res = await nvim.resumeNotification()
    this.bufnr = res[0][1] as number
    this.interval = setInterval(() => {
      this.draw()
    }, interval)
  }

  public dispose(): void {
    this.bufnr = undefined
    this.messagesMap.clear()
    this.statMap.clear()
    disposeAll(this.disposables)
    clearInterval(this.interval)
    this.interval = null
  }
}
