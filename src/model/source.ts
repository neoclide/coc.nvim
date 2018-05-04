import { Neovim } from 'neovim'
import {SourceOption,
  Filter,
  CompleteOption,
  CompleteResult} from '../types'

export default abstract class Source {
  public readonly name: string
  public readonly shortcut?: string
  public readonly priority: number
  public readonly filetypes: string[]
  public readonly engross: boolean
  public readonly filter?: Filter
  public readonly nvim: Neovim
  protected readonly menu: string
  constructor(nvim: Neovim, option: SourceOption) {
    this.nvim = nvim
    this.name = option.name
    this.shortcut = option.shortcut
    this.priority = option.priority || 0
    this.filetypes = option.filetypes || []
    this.engross = !!option.engross
    this.filter = option.filter
    if (option.shortcut) {
      this.menu = `[${option.shortcut}]`
    } else {
      this.menu = `[${option.name.slice(0, 5)}]`
    }
  }
  public abstract shouldComplete(opt: CompleteOption): Promise<boolean>
  public abstract doComplete(opt: CompleteOption): Promise<CompleteResult>
}
