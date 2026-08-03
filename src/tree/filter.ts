'use strict'
import events from '../events'
import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from '../util/protocol'
import { disposeAll } from '../util'
export const sessionKey = 'filter'

export class HistoryInput {
  private history: string[] = []

  public next(input: string): string | undefined {
    let idx = this.history.indexOf(input)
    return this.history[idx + 1] ?? this.history[0]
  }

  public previous(input: string): string | undefined {
    let idx = this.history.indexOf(input)
    return this.history[idx - 1] ?? this.history[this.history.length - 1]
  }

  public add(input: string): void {
    let idx = this.history.indexOf(input)
    if (idx !== -1) {
      this.history.splice(idx, 1)
    }
    this.history.unshift(input)
  }

  public toJSON(): string {
    return `[${this.history.join(',')}]`
  }
}

export default class Filter<T> {
  private _activated = false
  private text: string
  private history = new HistoryInput()
  private disposables: Disposable[] = []
  private readonly _onDidUpdate = new Emitter<string>()
  private readonly _onDidExit = new Emitter<T | undefined>()
  private readonly _onDidKeyPress = new Emitter<string>()
  public readonly onDidKeyPress: Event<string> = this._onDidKeyPress.event
  public readonly onDidUpdate: Event<string> = this._onDidUpdate.event
  public readonly onDidExit: Event<T | undefined> = this._onDidExit.event
  constructor(private nvim: Neovim, keys: string[]) {
    this.text = ''
    events.on('InputChar', (session, character) => {
      if (session !== sessionKey || !this._activated) return
      if (!keys.includes(character)) {
        if (character.length == 1) {
          this.text = this.text + character
          this._onDidUpdate.fire(this.text)
          return
        }
        if (character == '<bs>' || character == '<C-h>') {
          this.text = this.text.slice(0, -1)
          this._onDidUpdate.fire(this.text)
          return
        }
        if (character == '<C-u>') {
          this.text = ''
          this._onDidUpdate.fire(this.text)
          return
        }
        if (character == '<C-n>') {
          let text = this.history.next(this.text)
          if (text) {
            this.text = text
            this._onDidUpdate.fire(this.text)
          }
          return
        }
        if (character == '<C-p>') {
          let text = this.history.previous(this.text)
          if (text) {
            this.text = text
            this._onDidUpdate.fire(this.text)
          }
        }
        if (character == '<esc>' || character == '<C-o>') {
          this.deactivate()
          return
        }
      }
      this._onDidKeyPress.fire(character)
    }, null, this.disposables)
  }

  public active(): void {
    this._activated = true
    this.text = ''
    this.nvim.call('coc#prompt#start_prompt', [sessionKey], true)
  }

  public deactivate(node?: T): void {
    if (!this._activated) return
    this.nvim.call('coc#prompt#stop_prompt', [sessionKey], true)
    this._activated = false
    let { text } = this
    this.text = ''
    this._onDidExit.fire(node)
    this.history.add(text)
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
