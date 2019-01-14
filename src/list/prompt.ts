import { Emitter, Event } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { ListMode } from '../types'
import { Neovim } from '@chemzqm/neovim'
const logger = require('../util/logger')('list-prompt')

export default class Prompt {
  private indicator: string
  private cusorIndex = 0
  private _input = ''
  private _mode: ListMode

  private _onDidChangeInput = new Emitter<string>()
  public readonly onDidChangeInput: Event<string> = this._onDidChangeInput.event

  constructor(private nvim: Neovim) {
    let preferences = workspace.getConfiguration('list')
    this.indicator = preferences.get<string>('indicator', '>')
  }

  public get input(): string {
    return this._input
  }

  public set input(str: string) {
    if (this._input == str) return
    this.cusorIndex = str.length
    this._input = str
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public get mode(): ListMode {
    return this._mode
  }

  public set mode(val: ListMode) {
    if (val == this._mode) return
    this._mode = val
    this.drawPrompt()
  }

  public start(input?: string): void {
    if (input != null) {
      this._input = input
      this.cusorIndex = input.length
    }
    this.nvim.call('coc#list#start_prompt', [], true)
    this.drawPrompt()
  }

  public cancel(): void {
    this.nvim.call('coc#list#stop_prompt', [], true)
  }

  public reset(): void {
    this._input = ''
    this.cusorIndex = 0
  }

  public drawPrompt(): void {
    let { indicator, cusorIndex, input } = this
    let cmds = ['echo ""']
    if (this.mode == 'insert') {
      cmds.push(`echohl Special | echon '${indicator} ' | echohl None`)
      if (cusorIndex == input.length) {
        cmds.push(`echon '${input.replace(/'/g, "''")}'`)
      } else {
        let pre = input.slice(0, cusorIndex)
        if (pre) cmds.push(`echon '${pre.replace(/'/g, "''")}'`)
        cmds.push(`echohl Cursor | echon '${input[cusorIndex].replace(/'/, "''")}' | echohl None`)
        let post = input.slice(cusorIndex + 1)
        cmds.push(`echon '${post.replace(/'/g, "''")}'`)
      }
    }
    let cmd = cmds.join('|')
    this.nvim.command(cmd)
  }

  public moveLeft(): void {
    if (this.cusorIndex == 0) return
    this.cusorIndex = this.cusorIndex - 1
    this.drawPrompt()
  }

  public moveRight(): void {
    if (this.cusorIndex == this._input.length) return
    this.cusorIndex = this.cusorIndex + 1
    this.drawPrompt()
  }

  public moveToEnd(): void {
    if (this.cusorIndex == this._input.length) return
    this.cusorIndex = this._input.length
    this.drawPrompt()
  }

  public moveToStart(): void {
    if (this.cusorIndex == 0) return
    this.cusorIndex = 0
    this.drawPrompt()
  }

  public onBackspace(): void {
    let { cusorIndex, input } = this
    if (cusorIndex == 0) return
    let pre = input.slice(0, cusorIndex)
    let post = input.slice(cusorIndex)
    this.cusorIndex = cusorIndex - 1
    this._input = `${pre.slice(0, pre.length - 1)}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeNext(): void {
    let { cusorIndex, input } = this
    if (cusorIndex == input.length - 1) return
    let pre = input.slice(0, cusorIndex)
    let post = input.slice(cusorIndex + 1)
    this._input = `${pre}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeWord(): void {
    let { cusorIndex, input } = this
    if (cusorIndex == 0) return
    let pre = input.slice(0, cusorIndex)
    let post = input.slice(cusorIndex)
    let remain = pre.replace(/[\w$]+([^\w$]+)?$/, '')
    this.cusorIndex = cusorIndex - (pre.length - remain.length)
    this._input = `${remain}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeTail(): void {
    let { cusorIndex, input } = this
    if (cusorIndex == input.length) return
    let pre = input.slice(0, cusorIndex)
    this._input = pre
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeAhead(): void {
    let { cusorIndex, input } = this
    if (cusorIndex == 0) return
    let post = input.slice(cusorIndex)
    this.cusorIndex = 0
    this._input = post
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public insertCharacter(ch: string): void {
    let { cusorIndex, input } = this
    this.cusorIndex = cusorIndex + 1
    let pre = input.slice(0, cusorIndex)
    let post = input.slice(cusorIndex)
    this._input = `${pre}${ch}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }
}
