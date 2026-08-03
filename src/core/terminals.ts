'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { TerminalModel, TerminalOptions } from '../model/terminal'
import { disposeAll } from '../util'
import { toObject } from '../util/object'
import { Disposable, Emitter, Event } from '../util/protocol'

export interface TerminalResult {
  bufnr: number
  success: boolean
  content?: string
}

export interface OpenTerminalOption {
  /**
   * Cwd of terminal, default to result of |getcwd()|
   */
  cwd?: string
  /**
   * Close terminal on job finish, default to true.
   */
  autoclose?: boolean
  /**
   * Keep focus current window, default to false.
   */
  keepfocus?: boolean
  /**
   * Position of terminal window, default to 'right'.
   */
  position?: 'bottom' | 'right'
}

export default class Terminals {
  private _terminals: Map<number, TerminalModel> = new Map()
  private disposables: Disposable[] = []
  private readonly _onDidOpenTerminal = new Emitter<TerminalModel>()
  private readonly _onDidCloseTerminal = new Emitter<TerminalModel>()
  public readonly onDidCloseTerminal: Event<TerminalModel> = this._onDidCloseTerminal.event
  public readonly onDidOpenTerminal: Event<TerminalModel> = this._onDidOpenTerminal.event

  constructor() {
    events.on('BufUnload', bufnr => {
      if (this._terminals.has(bufnr)) {
        let terminal = this._terminals.get(bufnr)
        this._onDidCloseTerminal.fire(terminal)
        this._terminals.delete(bufnr)
      }
    }, null, this.disposables)
    events.on('TermExit', (bufnr, status) => {
      let terminal = this._terminals.get(bufnr)
      if (terminal) {
        terminal.onExit(status)
        terminal.dispose()
      }
    }, null, this.disposables)
  }

  public get terminals(): ReadonlyArray<TerminalModel> {
    return Array.from(this._terminals.values())
  }

  public async createTerminal(nvim: Neovim, opts: TerminalOptions): Promise<TerminalModel> {
    let cwd = opts.cwd
    let cmd = opts.shellPath
    let args = opts.shellArgs
    if (!cmd) cmd = await nvim.getOption('shell') as string
    if (!cwd) cwd = await nvim.call('getcwd') as string
    let terminal = new TerminalModel(cmd, args || [], nvim, opts.name, opts.strictEnv)
    await terminal.start(cwd, opts.env)
    this._terminals.set(terminal.bufnr, terminal)
    this._onDidOpenTerminal.fire(terminal)
    return terminal
  }

  public async runTerminalCommand(nvim: Neovim, cmd: string, cwd: string | undefined, keepfocus: boolean): Promise<TerminalResult> {
    return await nvim.callAsync('coc#ui#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 }) as TerminalResult
  }

  public async openTerminal(nvim: Neovim, cmd: string, opts?: OpenTerminalOption): Promise<number> {
    return await nvim.call('coc#ui#open_terminal', { cmd, ...toObject(opts) }) as number
  }

  public reset(): void {
    for (let terminal of this._terminals.values()) {
      terminal.dispose()
    }
    this._terminals.clear()
  }

  public dispose(): void {
    this._onDidOpenTerminal.dispose()
    this._onDidCloseTerminal.dispose()
    disposeAll(this.disposables)
    this.reset()
  }
}
