'use strict'
import { Neovim } from '@chemzqm/neovim'
import { OutputChannel } from '../types'

function escapeQuote(input: string): string {
  return input.replace(/'/g, "''")
}

/**
 * Maximum number of lines retained per channel. Verbose LSP tracing or chatty
 * servers can append thousands of lines, and keeping every line in Node memory
 * (and joining them all when the buffer is opened) grows unbounded.
 */
const MAX_LINE_COUNT = 50000

export default class BufferChannel implements OutputChannel {
  private lines: string[] = ['']
  private _disposed = false
  public created = false
  constructor(public name: string, private nvim?: Neovim, private onDispose?: () => void, private maxLineCount = MAX_LINE_COUNT) {
  }

  public get content(): string {
    return this.lines.join('\n')
  }

  private _append(value: string): void {
    let { nvim } = this
    if (!nvim) return
    let idx = this.lines.length - 1
    let newlines = value.split(/\r?\n/)
    let lastline = this.lines[idx] + newlines[0]
    this.lines[idx] = lastline
    let append = newlines.slice(1)
    this.lines = this.lines.concat(append)
    // Keep only the newest maxLineCount lines so long sessions don't grow
    // the channel (and the output buffer) without bound.
    let removed = 0
    let rewrite = false
    if (this.maxLineCount > 0 && this.lines.length > this.maxLineCount) {
      removed = this.lines.length - this.maxLineCount
      this.lines.splice(0, removed)
      // When a single append is so large that it pushed out the previous last
      // line, rewrite the buffer instead of syncing the shifted tail.
      let lastIdx = this.lines.length - append.length - 1
      if (lastIdx < 0) {
        rewrite = true
      } else {
        lastline = this.lines[lastIdx]
      }
    }
    if (!this.created) return
    nvim.pauseNotification()
    if (rewrite) {
      nvim.call('deletebufline', [this.bufname, 1, '$'], true)
      nvim.call('appendbufline', [this.bufname, '$', this.lines], true)
    } else {
      if (removed > 0) {
        nvim.call('deletebufline', [this.bufname, 1, removed], true)
      }
      nvim.call('setbufline', [this.bufname, '$', lastline], true)
      if (append.length) {
        nvim.call('appendbufline', [this.bufname, '$', append], true)
      }
    }
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
    let { nvim } = this
    if (!this.validate() || !nvim) return
    this.lines = keep ? this.lines.slice(-keep) : []
    if (!this.created) return
    nvim.pauseNotification()
    nvim.call('deletebufline', [this.bufname, 1, '$'], true)
    if (this.lines.length) {
      nvim.call('appendbufline', [this.bufname, '$', this.lines], true)
    }
    nvim.resumeNotification(true, true)
  }

  public hide(): void {
    this.created = false
    let name = escapeQuote(this.bufname)
    if (this.nvim) this.nvim.command(`exe 'silent! bwipeout! '.fnameescape('${name}')`, true)
  }

  private get bufname(): string {
    return `output:///${encodeURI(this.name)}`
  }

  public show(preserveFocus?: boolean, cmd = 'vs'): void {
    let { nvim } = this
    if (!nvim) return
    let name = escapeQuote(this.bufname)
    nvim.pauseNotification()
    nvim.command(`exe '${cmd} '.fnameescape('${name}')`, true)
    if (preserveFocus) {
      nvim.command('wincmd p', true)
    }
    nvim.resumeNotification(true, true)
    this.created = true
  }

  private validate(): boolean {
    return !this._disposed
  }

  public dispose(): void {
    if (this.onDispose) this.onDispose()
    this._disposed = true
    this.hide()
    this.lines = []
  }
}
