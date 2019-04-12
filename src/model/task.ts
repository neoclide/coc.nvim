import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { TaskOptions } from '../types'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { disposeAll } from '../util'

/**
 * Task - task run by vim
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

  public async start(opts: TaskOptions): Promise<boolean> {
    let { nvim } = this
    return await nvim.call('coc#task#start', [this.id, opts])
  }

  public async stop(): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#task#stop', [this.id])
  }

  public get running(): Promise<boolean> {
    let { nvim } = this
    return nvim.call('coc#task#running', [this.id])
  }

  public dispose(): void {
    let { nvim } = this
    nvim.call('coc#task#stop', [this.id], true)
    this._onStdout.dispose()
    this._onStderr.dispose()
    this._onExit.dispose()
    disposeAll(this.disposables)
  }
}
