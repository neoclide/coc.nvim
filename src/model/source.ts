import { Neovim } from '@chemzqm/neovim'
import { CompleteOption, CompleteResult, ISource, SourceConfig, SourceType, VimCompleteItem } from '../types'
import { fuzzyChar } from '../util/fuzzy'
import { byteSlice, byteLength } from '../util/string'
import workspace from '../workspace'
import { TextEdit } from 'vscode-languageserver-types'
const logger = require('../util/logger')('model-source')

export default abstract class Source implements ISource {
  public readonly name: string
  public readonly filepath: string
  public readonly sourceType: SourceType
  public readonly triggerCharacters: string[]
  // exists opitonnal function names for remote source
  public readonly optionalFns: string[]
  public readonly isSnippet: boolean
  public readonly isFallback: boolean
  protected readonly nvim: Neovim
  private _disabled = false
  constructor(option: SourceConfig) {
    let { name, optionalFns } = option
    this.name = name
    this.nvim = workspace.nvim
    this.isSnippet = !!option.isSnippet
    this.isFallback = !!option.isFallback
    this.optionalFns = optionalFns || []
    this.filepath = option.filepath || ''
    this.sourceType = option.sourceType || SourceType.Native
    this.triggerCharacters = option.triggerCharacters || this.getConfig<string[]>('triggerCharacters', [])
  }

  public get priority(): number {
    return this.getConfig('priority', 1)
  }

  public get shortcut(): string {
    let shortcut = this.getConfig('shortcut', null)
    return shortcut ? shortcut : this.name.slice(0, 3)
  }

  public get enable(): boolean {
    if (this._disabled) return false
    return this.getConfig('enable', true)
  }

  public get filetypes(): string[] | null {
    return this.getConfig('filetypes', null)
  }

  public getConfig<T>(key: string, defaultValue?: T): T | null {
    let config = workspace.getConfiguration(`coc.source.${this.name}`)
    return config.get(key, defaultValue)
  }

  public toggle(): void {
    this._disabled = !this._disabled
  }

  public get firstMatch(): boolean {
    return this.getConfig('firstMatch', false)
  }

  public get menu(): string {
    let { shortcut } = this
    return `[${shortcut.toUpperCase()}]`
  }

  protected filterWords(words: string[], opt: CompleteOption): string[] {
    let res = []
    let { input } = opt
    let cword = opt.word
    if (!input.length) return []
    let cFirst = input[0]
    for (let word of words) {
      if (!word || word.length < 3) continue
      if (cFirst && !fuzzyChar(cFirst, word[0])) continue
      if (word == cword || word == input) continue
      res.push(word)
    }
    return res
  }

  /**
   * fix start column for new valid characters
   *
   * @protected
   * @param {CompleteOption} opt
   * @param {string[]} valids - valid charscters
   * @returns {number}
   */
  protected fixStartcol(opt: CompleteOption, valids: string[]): number {
    let { col, input, line, bufnr } = opt
    let start = byteSlice(line, 0, col)
    let document = workspace.getDocument(bufnr)
    if (!document) return col
    let { chars } = document
    for (let i = start.length - 1; i >= 0; i--) {
      let c = start[i]
      if (!chars.isKeywordChar(c) && valids.indexOf(c) === -1) {
        break
      }
      input = `${c}${input}`
      col = col - 1
    }
    opt.col = col
    opt.input = input
    return col
  }

  public async refresh(): Promise<void> {
    // do nothing
  }

  public async onCompleteResolve(_item: VimCompleteItem): Promise<void> {
    // do nothing
  }

  public async onCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void> {
    let { nvim } = this
    // do nothing
    let user_data = JSON.parse(item.user_data)
    if (user_data.textEdit) {
      let { line, linenr } = opt
      let { range, newText } = user_data.textEdit as TextEdit
      let start = line.substr(0, range.start.character)
      let end = line.substr(range.end.character)
      await nvim.call('coc#util#setline', [linenr, `${start}${newText}${end}`])
      await nvim.call('cursor', [linenr, byteLength(start + newText) + 1])
    }
  }

  public abstract doComplete(opt: CompleteOption): Promise<CompleteResult | null>
}
