import { Neovim } from '@chemzqm/neovim'
import { Emitter, Event } from 'vscode-languageserver-protocol'
import { ListMode, Matcher, ListOptions } from '../types'
import workspace from '../workspace'
import ListConfiguration from './configuration'
const logger = require('../util/logger')('list-prompt')

export default class Prompt {
  private cusorIndex = 0
  private _input = ''
  private _matcher: Matcher | ''
  private _mode: ListMode
  private interactive = false

  private _onDidChangeInput = new Emitter<string>()
  public readonly onDidChangeInput: Event<string> = this._onDidChangeInput.event

  constructor(private nvim: Neovim, private config: ListConfiguration) {
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

  public set matcher(val: Matcher) {
    this._matcher = val
    this.drawPrompt()
  }

  public start(opts?: ListOptions): void {
    if (opts) {
      this.interactive = opts.interactive
      this._input = opts.input
      this.cusorIndex = opts.input.length
      this._mode = opts.mode
      this._matcher = opts.interactive ? '' : opts.matcher
    }
    this.nvim.callTimer('coc#list#start_prompt', [], true)
    this.drawPrompt()
  }

  public cancel(): void {
    let { nvim } = this
    nvim.command('echo ""', true)
    nvim.command('redraw', true)
    nvim.call('coc#list#stop_prompt', [], true)
  }

  public reset(): void {
    this._input = ''
    this.cusorIndex = 0
  }

  public drawPrompt(): void {
    let indicator = this.config.get<string>('indicator', '>')
    let { cusorIndex, interactive, input, _matcher } = this
    let cmds = workspace.isVim ? ['echo ""'] : ['redraw']
    if (this.mode == 'insert') {
      if (interactive) {
        cmds.push(`echohl MoreMsg | echon 'INTERACTIVE ' | echohl None`)
      } else if (_matcher) {
        cmds.push(`echohl MoreMsg | echon '${_matcher.toUpperCase()} ' | echohl None`)
      }
      cmds.push(`echohl Special | echon '${indicator} ' | echohl None`)
      if (cusorIndex == input.length) {
        cmds.push(`echon '${input.replace(/'/g, "''")}'`)
        if (workspace.isVim) {
          cmds.push(`echohl Cursor | echon ' ' | echohl None`)
        }
      } else {
        let pre = input.slice(0, cusorIndex)
        if (pre) cmds.push(`echon '${pre.replace(/'/g, "''")}'`)
        cmds.push(`echohl Cursor | echon '${input[cusorIndex].replace(/'/, "''")}' | echohl None`)
        let post = input.slice(cusorIndex + 1)
        cmds.push(`echon '${post.replace(/'/g, "''")}'`)
      }
    } else {
      cmds.push(`echohl MoreMsg | echo "" | echohl None`)
    }
    if (workspace.isVim) cmds.push('redraw')
    let cmd = cmds.join('|')
    this.nvim.command(cmd, true)
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
