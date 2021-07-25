import events from '../events'
import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { disposeAll } from '../util'
export const sessionKey = 'filter'

export default class Filter {
  private _activated = false
  private text: string
  private disposables: Disposable[] = []
  private readonly _onDidUpdate = new Emitter<string>()
  private readonly _onDidExit = new Emitter<void>()
  private readonly _onDidKeyPress = new Emitter<string>()
  public readonly onDidKeyPress: Event<string> = this._onDidKeyPress.event
  public readonly onDidUpdate: Event<string> = this._onDidUpdate.event
  public readonly onDidExit: Event<void> = this._onDidExit.event
  constructor(private nvim: Neovim) {
    this.text = ''
    events.on('InputChar', (session, character) => {
      if (session !== sessionKey || !this._activated) return
      if (character.length == 1) {
        this.text = this.text + character
        this._onDidUpdate.fire(this.text)
        return
      }
      if (character == '<bs>') {
        this.text = this.text.slice(0, -1)
        this._onDidUpdate.fire(this.text)
        return
      }
      if (character == '<C-u>') {
        this.text = ''
        this._onDidUpdate.fire(this.text)
        return
      }
      if (character == '<esc>') {
        this.deactivate()
        return
      }
      this._onDidKeyPress.fire(character)
    }, null, this.disposables)
  }

  public active(): void {
    if (this._activated) return
    this._activated = true
    this.text = ''
    this.nvim.call('coc#prompt#start_prompt', [sessionKey], true)
  }

  public deactivate(): void {
    if (!this._activated) return
    this.nvim.call('coc#prompt#stop_prompt', [sessionKey], true)
    this._activated = false
    this.text = ''
    this._onDidExit.fire()
  }

  public get activated(): boolean {
    return this._activated
  }

  public dispose(): void {
    this.deactivate()
    this._onDidKeyPress.dispose()
    this._onDidUpdate.dispose()
    this._onDidExit.dispose()
    disposeAll(this.disposables)
  }
}
