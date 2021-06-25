import { Neovim } from '@chemzqm/neovim'
const isVim = process.env.VIM_NODE_RPC == '1'

/**
 * More methods for float window/popup
 */
export default class Popup {
  constructor(
    private nvim: Neovim,
    public readonly winid,
    public readonly bufnr) {
  }

  public get valid(): Promise<boolean> {
    return this.nvim.call('coc#float#valid', [this.winid]).then(res => {
      return !!res
    })
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

  /**
   * Simple scroll method, not consider wrapped lines.
   */
  public async scrollForward(): Promise<void> {
    let { nvim, bufnr, winid } = this
    let buf = nvim.createBuffer(bufnr)
    let total = await buf.length
    let botline: number
    if (!isVim) {
      let infos = await nvim.call('getwininfo', [winid])
      if (!infos || !infos.length) return
      botline = infos[0].botline
    } else {
      botline = await nvim.eval(`get(popup_getpos(${winid}), 'lastline', 0)`) as number
    }
    if (botline >= total || botline == 0) return
    nvim.pauseNotification()
    this.setCursor(botline - 1)
    this.execute(`silent! noa setl scrolloff=0`)
    this.execute(`normal! ${botline}Gzt`)
    this.refreshScrollbar()
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  /**
   * Simple scroll method, not consider wrapped lines.
   */
  public async scrollBackward(): Promise<void> {
    let { nvim, winid } = this
    let topline: number
    if (!isVim) {
      let infos = await nvim.call('getwininfo', [winid])
      if (!infos || !infos.length) return
      topline = infos[0].topline
    } else {
      topline = await nvim.eval(`get(popup_getpos(${winid}), 'firstline', 0)`) as number
    }
    if (topline == 1) return
    nvim.pauseNotification()
    this.setCursor(topline - 1)
    this.execute(`normal! ${topline}Gzb`)
    this.refreshScrollbar()
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  /**
   * Move cursor and highlight.
   */
  public setCursor(index: number): void {
    let { nvim, bufnr, winid } = this
    if (isVim) {
      nvim.call('win_execute', [winid, `exe ${index + 1}`], true)
    } else {
      let win = nvim.createWindow(winid)
      win.notify('nvim_win_set_cursor', [[index + 1, 0]])
      nvim.command(`sign unplace 6 buffer=${bufnr}`, true)
      nvim.command(`sign place 6 line=${index + 1} name=CocCurrentLine buffer=${bufnr}`, true)
    }
  }
}
