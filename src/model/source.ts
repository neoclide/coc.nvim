import {equalChar} from '../util/index'
import { Neovim } from 'neovim'
import {getConfig} from '../config'
import {getSourceConfig} from '../config'
import {filterFuzzy, filterWord} from '../util/filter'
import {SourceOption,
  VimCompleteItem,
  CompleteOption,
  CompleteResult} from '../types'
const logger = require('../util/logger')('model-source')

export default abstract class Source {
  public readonly name: string
  public shortcut?: string
  public filetypes: string[] | null | undefined
  public engross: boolean
  public priority: number
  public optionalFns: string[]
   [index: string]: any
  protected readonly nvim: Neovim
  constructor(nvim: Neovim, option: SourceOption) {
    let {shortcut, filetypes, name, priority, optionalFns}  = option
    this.nvim = nvim
    this.name = name
    this.priority = priority || 0
    this.engross = !!option.engross
    let opt = getSourceConfig(name) || {}
    shortcut = opt.shortcut || shortcut
    this.optionalFns = optionalFns || []
    this.filetypes = opt.filetypes || Array.isArray(filetypes) ? filetypes : null
    this.shortcut = shortcut ? shortcut.slice(0, 3) : name.slice(0, 3)
  }

  public get menu():string {
    return `[${this.shortcut.toUpperCase()}]`
  }

  protected convertToItems(list:any[], extra: any = {}):VimCompleteItem[] {
    let {menu} = this
    let res = []
    for (let item of list) {
      if (typeof item == 'string') {
        res.push(Object.assign({word: item, menu}, extra))
      }
      if (item.hasOwnProperty('word')) {
        if (item.menu) extra.info = item.menu
        res.push(Object.assign(item, {menu}, extra))
      }
    }
    return res
  }

  protected filterWords(words:string[], opt:CompleteOption):string[] {
    let fuzzy = getConfig('fuzzyMatch')
    let res = []
    let {input} = opt
    let cword = opt.word
    let cFirst = input.length ? input[0] : null
    let icase = !/[A-Z]/.test(input)
    let filter = fuzzy ? filterFuzzy : filterWord
    for (let word of words) {
      if (!cFirst) continue
      if (!word || word.length < 3) continue
      if (cFirst && !equalChar(word[0], cFirst, icase)) continue
      if (word == cword || word == input) continue
      res.push(word)
    }
    return res
  }

  public checkFileType(filetype: string):boolean {
    if (this.filetypes == null) return true
    return this.filetypes.indexOf(filetype) !== -1
  }

  // some source could overwrite it
  public async refresh():Promise<void> {
    // do nothing
  }

  public abstract shouldComplete(opt: CompleteOption): Promise<boolean>

  public abstract doComplete(opt: CompleteOption): Promise<CompleteResult | null>
}
