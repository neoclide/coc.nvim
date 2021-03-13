import { promisify } from 'util'
import { Terminal } from '../types'
import { Neovim } from '@chemzqm/neovim'
import { execFile, execFileSync } from 'child_process'
import { EOL } from 'os'
import { env } from 'process'

const execFileAsync = promisify(execFile)

export default class TmuxTerminalModel implements Terminal {
  public bufnr: number
  private pid = 0
  private baseArgs: string[]

  constructor(private cmd: string,
    private args: string[],
    private nvim: Neovim,
    private _name?: string) {
    const socket = env.TMUX.split(',')[0]
    this.baseArgs = ['-S', socket]
  }

  public async start(cwd?: string, env?: { [key: string]: string | null }): Promise<void> {
    let args = this.baseArgs.concat(['split-window', '-P'])
    if (cwd) {
      args.push('-c', cwd)
    }
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        args.push('-e', `${k}=${v}`)
      }
    }
    args.push(this.cmd, ...this.args)
    const splitProc = await execFileAsync('tmux', args)
    const pane = splitProc.stdout.trim()
    const pidsProc = await execFileAsync(
      'tmux',
      this.baseArgs.concat([
        'list-panes',
        '-aF',
        '#{session_name}:#{window_index}.#{pane_index}|#{pane_pid}',
      ]),
    )
    const paneToPid = Object.fromEntries(
      pidsProc.stdout
        .trim()
        .split(EOL)
        .map(line => line.split('|'))
    )
    this.pid = parseInt(paneToPid[pane], 10)
    this.bufnr = null
  }

  public get name(): string {
    return this._name || this.cmd
  }

  public get processId(): Promise<number> {
    return Promise.resolve(this.pid)
  }

  public sendText(text: string, addNewLine = true): void {
    const pane = this.getPaneSync()
    if (pane) {
      execFileSync('tmux', this.baseArgs.concat('send-keys', '-lt', pane, text))
      if (addNewLine) {
        execFileSync('tmux', this.baseArgs.concat('send-keys', '-t', pane, 'Enter'))
      }
    }
  }

  public async show(_preserveFocus?: boolean): Promise<boolean> {
    const pane = await this.getPane()
    if (pane) {
      await execFileAsync('tmux', this.baseArgs.concat(['join-pane', '-s', pane]))
      return true
    } else {
      return false
    }
  }

  public async hide(): Promise<void> {
    const pane = await this.getPane()
    if (pane) {
      await execFileAsync('tmux', this.baseArgs.concat(['break-pane', '-ds', pane]))
    }
  }

  public dispose(): void {
    const pane = this.getPaneSync()
    if (pane) {
      execFileSync('tmux', this.baseArgs.concat(['kill-pane', '-t', pane]))
    }
  }

  private async getPane(): Promise<string> {
    const proc = await execFileAsync(
      'tmux',
      this.baseArgs.concat([
        'list-panes',
        '-aF',
        '#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}',
      ])
    )
    return Object.fromEntries(
      proc.stdout
        .trim()
        .split(EOL)
        .map(line => line.split('|'))
    )[this.pid]
  }

  private getPaneSync(): string {
    return Object.fromEntries(
      execFileSync(
        'tmux',
        this.baseArgs.concat([
          'list-panes',
          '-aF',
          '#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}',
        ]),
        {encoding: "utf8"},
      )
      .trim()
      .split(EOL)
      .map(line => line.split('|'))
    )[this.pid]
  }
}

