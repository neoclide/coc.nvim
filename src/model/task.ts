'use strict'
import { Neovim } from '../neovim'
import events from '../events'
import { disposeAll } from '../util'
import { Disposable, Emitter, Event } from '../util/protocol'

export interface TaskOptions {
  cmd: string
  args?: string[]
  cwd?: string
  pty?: boolean
  env?: { [key: string]: string }
  detach?: boolean
}

/**
 * Controls long running task started by vim.
 * Useful to keep the task running after CocRestart.
 * @public
 */
export default class Task implements Disposable {
  private disposables: Disposable[] = []
  private readonly _onExit = new Emitter<number>()
  private readonly _onStderr = new Emitter<string[]>()
  private readonly _onStdout = new Emitter<string[]>()
  public readonly onExit: Event<number> = this._onExit.event
  public readonly onStdout: Event<string[]> = this._onStdout.event
  public readonly onStderr: Event<string[]> = this._onStderr.event

  /**
   * @param {Neovim} nvim
   * @param {string} id unique id
   */
  constructor(private nvim: Neovim, private id: string) {
    events.on('TaskExit', (id, code) => {
      if (id == this.id) {
        this._onExit.fire(code)
      }
    }, null, this.disposables)
    events.on('TaskStderr', (id, lines) => {
      if (id == this.id) {
        this._onStderr.fire(lines)
      }
    }, null, this.disposables)
    events.on('TaskStdout', (id, lines) => {
      if (id == this.id) {
        this._onStdout.fire(lines)
      }
    }, null, this.disposables)
  }

  /**
   * Start task, task will be restarted when already running.
   * @param {TaskOptions} opts
   * @returns {Promise<boolean>}
   */
  public async start(opts: TaskOptions): Promise<boolean> {
    let { nvim } = this
    return await nvim.call('coc#task#start', [this.id, opts]) as boolean
  }

  /**
   * Stop task by SIGTERM or SIGKILL
   */
  public async stop(): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#task#stop', [this.id])
  }

  /**
   * Check if the task is running.
   */
  public get running(): Promise<boolean> {
    let { nvim } = this
    return nvim.call('coc#task#running', [this.id]) as Promise<boolean>
  }

  /**
   * Stop task and dispose all events.
   */
  public dispose(): void {
    let { nvim } = this
    nvim.call('coc#task#stop', [this.id], true)
    this._onStdout.dispose()
    this._onStderr.dispose()
    this._onExit.dispose()
    disposeAll(this.disposables)
  }
}
