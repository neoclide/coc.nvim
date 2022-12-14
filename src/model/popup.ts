'use strict'
import { Neovim } from '@chemzqm/neovim'
import { isVim } from '../util/constants'

interface WindowInfo {
  topline: number,
  botline: number
}

/**
 * More methods for float window/popup
 */
export default class Popup {
  constructor(
    private nvim: Neovim,
    public readonly winid,
    public readonly bufnr,
    public linecount: number,
    private _currIndex = 0
  ) {
  }

  public get currIndex(): number {
    return this._currIndex
  }

  public close(): void {
    this.nvim.call('coc#float#close', [this.winid], true)
  }

  public refreshScrollbar(): void {
    if (!isVim) this.nvim.call('coc#float#nvim_scrollbar', [this.winid], true)
  }

  public execute(cmd: string): void {
    this.nvim.call('coc#compat#execute', [this.winid, cmd], true)
  }

  private async getWininfo(): Promise<WindowInfo> {
    return await this.nvim.call('coc#float#get_wininfo', [this.winid]) as WindowInfo
  }

  /**
   * Simple scroll method, not consider wrapped lines.
   */
  public async scrollForward(): Promise<void> {
    let { nvim, bufnr } = this
    let buf = nvim.createBuffer(bufnr)
    let total = await buf.length
    let { botline } = await this.getWininfo()
    if (botline >= total || botline == 0) return
    nvim.pauseNotification()
    this.setCursor(botline - 1)
    this.execute(`silent! noa setl scrolloff=0`)
    this.execute(`normal! ${botline}Gzt`)
    this.refreshScrollbar()
    nvim.command('redraw', true)
    nvim.resumeNotification(false, true)
  }

  /**
   * Simple scroll method, not consider wrapped lines.
   */
  public async scrollBackward(): Promise<void> {
    let { nvim } = this
    let { topline } = await this.getWininfo()
    if (topline == 1) return
    nvim.pauseNotification()
    this.setCursor(topline - 1)
    this.execute(`normal! ${topline}Gzb`)
    this.refreshScrollbar()
    nvim.command('redraw', true)
    nvim.resumeNotification(false, true)
  }

  /**
   * Move cursor and highlight.
   */
  public setCursor(index: number, redraw = false): void {
    let { nvim, bufnr, winid, linecount } = this
    if (index < 0) {
      index = 0
    } else if (index > linecount - 1) {
      index = linecount - 1
    }
    this._currIndex = index
    nvim.call('coc#dialog#set_cursor', [winid, bufnr, index + 1], true)
    if (redraw) {
      this.refreshScrollbar()
      nvim.command('redraw', true)
    }
  }
}
