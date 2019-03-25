import { Terminal } from '../types'
import { Neovim } from '@chemzqm/neovim'
const isVim = process.env.VIM_NODE_RPC == '1'

export default class TerminalModel implements Terminal {
  private chanId: number
  public bufnr: number

  constructor(private cmd: string,
    private args: string[],
    private nvim: Neovim,
    private _name?: string) {
  }

  public async start(cwd?: string, env?: { [key: string]: string | null }): Promise<void> {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('belowright 5new', true)
    nvim.command('setl winfixheight', true)
    nvim.command('setl norelativenumber', true)
    nvim.command('setl nonumber', true)
    if (env && Object.keys(env).length) {
      for (let key of Object.keys(env)) {
        nvim.command(`let $${key}='${env[key].replace(/'/g, "''")}'`, true)
      }
    }
    await nvim.resumeNotification()
    this.bufnr = await nvim.call('bufnr', '%')
    let cmd = [this.cmd, ...this.args]
    let opts: any = {}
    if (cwd) opts.cwd = cwd
    this.chanId = await nvim.call('termopen', [cmd, opts])
    if (env && Object.keys(env).length) {
      for (let key of Object.keys(env)) {
        nvim.command(`unlet $${key}`, true)
      }
    }
    await nvim.command('wincmd p')
  }

  public get name(): string {
    return this._name || this.cmd
  }

  public get processId(): Promise<number> {
    if (!this.chanId) return null
    return this.nvim.call('jobpid', this.chanId)
  }

  public sendText(text: string, addNewLine = true): void {
    let { chanId, nvim } = this
    if (!chanId) return
    let lines = text.split(/\r?\n/)
    if (addNewLine) {
      lines.push(process.platform.startsWith('win') ? '\r\n' : '\r')
    }
    nvim.call('chansend', [chanId, lines], true)
  }

  public async show(preserveFocus?: boolean): Promise<void> {
    let { bufnr, nvim } = this
    if (!bufnr) return
    let winnr = await nvim.call('bufwinnr', bufnr)
    if (winnr != -1) return
    nvim.pauseNotification()
    nvim.command(`below ${bufnr}sb`, true)
    nvim.command('resize 5', true)
    nvim.command('normal! G', true)
    if (preserveFocus) {
      nvim.command('wincmd p')
    }
    await nvim.resumeNotification()

  }

  public async hide(): Promise<void> {
    let { bufnr, nvim } = this
    if (!bufnr) return
    let winnr = await nvim.call('bufwinnr', bufnr)
    if (winnr == -1) return
    nvim.command(`${winnr}close!`, true)
  }

  public dispose(): void {
    let { bufnr, chanId, nvim } = this
    if (!chanId) return
    nvim.call('chanclose', [chanId], true)
    nvim.command(`silent! bd! ${bufnr}`, true)
  }
}
