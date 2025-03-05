'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Emitter, Event } from '../util/protocol'
import { getUnicodeClass } from '../util/string'
import listConfiguration from './configuration'
import { ListMode, ListOptions, Matcher } from './types'

export default class Prompt {
  private cursorIndex = 0
  private _input = ''
  private _matcher: Matcher | ''
  private _mode: ListMode = 'insert'
  private interactive = false
  private requestInput = false
  private _onDidChangeInput = new Emitter<string>()
  public readonly onDidChangeInput: Event<string> = this._onDidChangeInput.event

  constructor(private nvim: Neovim) {
  }

  public get input(): string {
    return this._input
  }

  public set input(str: string) {
    if (this._input == str) return
    this.cursorIndex = str.length
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
      this.cursorIndex = opts.input.length
      this._input = opts.input
      this._mode = opts.mode
      this._matcher = opts.interactive ? '' : opts.matcher
    }
    this.nvim.call('coc#prompt#start_prompt', ['list'], true)
    this.drawPrompt()
  }

  public cancel(): void {
    let { nvim } = this
    nvim.call('coc#prompt#stop_prompt', ['list'], true)
  }

  public reset(): void {
    this._input = ''
    this.cursorIndex = 0
  }

  public drawPrompt(): void {
    let indicator = listConfiguration.get<string>('indicator', '>')
    let { cursorIndex, interactive, input, _matcher } = this
    let cmds = ['echo ""']
    if (this.mode == 'insert') {
      if (interactive) {
        cmds.push(`echohl MoreMsg | echon 'INTERACTIVE ' | echohl None`)
      } else if (_matcher) {
        cmds.push(`echohl MoreMsg | echon '${_matcher.toUpperCase()} ' | echohl None`)
      }
      cmds.push(`echohl Special | echon '${indicator} ' | echohl None`)
      if (cursorIndex == input.length) {
        cmds.push(`echon '${input.replace(/'/g, "''")}'`)
        cmds.push(`echohl Cursor | echon ' ' | echohl None`)
      } else {
        let pre = input.slice(0, cursorIndex)
        if (pre) cmds.push(`echon '${pre.replace(/'/g, "''")}'`)
        cmds.push(`echohl Cursor | echon '${input[cursorIndex].replace(/'/, "''")}' | echohl None`)
        let post = input.slice(cursorIndex + 1)
        cmds.push(`echon '${post.replace(/'/g, "''")}'`)
      }
    } else {
      cmds.push(`echohl MoreMsg | echo "" | echohl None`)
    }
    cmds.push('redraw')
    let cmd = cmds.join('|')
    this.nvim.command(cmd, true)
  }

  public moveLeft(): void {
    if (this.cursorIndex == 0) return
    this.cursorIndex = this.cursorIndex - 1
    this.drawPrompt()
  }

  public moveRight(): void {
    if (this.cursorIndex == this._input.length) return
    this.cursorIndex = this.cursorIndex + 1
    this.drawPrompt()
  }

  public moveLeftWord(): void {
    // Reuses logic from removeWord(), except that we only update the
    // cursorIndex and don't actually remove the word.
    let { cursorIndex, input } = this
    if (cursorIndex == 0) return
    let pre = input.slice(0, cursorIndex)
    let remain = getLastWordRemovedText(pre)
    this.cursorIndex = cursorIndex - (pre.length - remain.length)
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public moveRightWord(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == input.length) return
    let post = input.slice(cursorIndex)
    let nextWord = post.match(/[\w$]+ */).at(0) ?? post
    this.cursorIndex = cursorIndex + nextWord.length
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public moveToEnd(): void {
    if (this.cursorIndex == this._input.length) return
    this.cursorIndex = this._input.length
    this.drawPrompt()
  }

  public moveToStart(): void {
    if (this.cursorIndex == 0) return
    this.cursorIndex = 0
    this.drawPrompt()
  }

  public onBackspace(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == 0) return
    let pre = input.slice(0, cursorIndex)
    let post = input.slice(cursorIndex)
    this.cursorIndex = cursorIndex - 1
    this._input = `${pre.slice(0, pre.length - 1)}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeNext(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == input.length) return
    let pre = input.slice(0, cursorIndex)
    let post = input.slice(cursorIndex + 1)
    this._input = `${pre}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeWord(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == 0) return
    let pre = input.slice(0, cursorIndex)
    let post = input.slice(cursorIndex)
    let remain = getLastWordRemovedText(pre)
    this.cursorIndex = cursorIndex - (pre.length - remain.length)
    this._input = `${remain}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeTail(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == input.length) return
    let pre = input.slice(0, cursorIndex)
    this._input = pre
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public removeAhead(): void {
    let { cursorIndex, input } = this
    if (cursorIndex == 0) return
    let post = input.slice(cursorIndex)
    this.cursorIndex = 0
    this._input = post
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }

  public async acceptCharacter(ch: string): Promise<void> {
    if (this.requestInput) {
      this.requestInput = false
      if (/^[0-9a-z"%#*+/:\-.]$/.test(ch)) {
        let text = await this.nvim.call('getreg', ch) as string
        text = text.replace(/\n/g, ' ')
        this.addText(text)
      }
    } else {
      this.addText(ch)
    }
  }

  public insertRegister(): void {
    this.requestInput = true
  }

  public async paste(): Promise<void> {
    let text = await this.nvim.eval('@*') as string
    text = text.replace(/\n/g, '')
    if (!text) return
    this.addText(text)
  }

  public async eval(expression: string): Promise<void> {
    let text = await this.nvim.call('eval', [expression]) as string
    text = text.replace(/\n/g, '')
    this.addText(text)
  }

  private addText(text: string): void {
    let { cursorIndex, input } = this
    this.cursorIndex = cursorIndex + text.length
    let pre = input.slice(0, cursorIndex)
    let post = input.slice(cursorIndex)
    this._input = `${pre}${text}${post}`
    this.drawPrompt()
    this._onDidChangeInput.fire(this._input)
  }
}

function getLastWordRemovedText(text: string): string {
  let res = text

  // Remove last whitespaces
  res = res.trimEnd()
  if (res === "") return res

  // Remove last contiguous characters of the same unicode class.
  const last = getUnicodeClass(res[res.length - 1])
  while (res !== "" && getUnicodeClass(res[res.length - 1]) === last) {
    res = res.slice(0, res.length - 1)
  }

  return res
}
