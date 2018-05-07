import { Neovim } from 'neovim'
import {getConfig} from '../config'
import {SourceOption,
  Filter,
  CompleteOption,
  CompleteResult} from '../types'

export default abstract class Source {
  public readonly name: string
  public readonly shortcut?: string
  public readonly priority: number
  public readonly filetypes: string[] | null | undefined
  public readonly engross: boolean
  public readonly filter?: Filter
  public readonly nvim: Neovim
  public disabled: boolean
  protected readonly menu: string
  constructor(nvim: Neovim, option: SourceOption) {
    this.nvim = nvim
    this.name = option.name
    this.shortcut = option.shortcut
    this.filetypes = option.filetypes || null
    this.engross = !!option.engross
    this.filter = option.filter == 'word' ? 'word' : 'fuzzy'
    if (option.shortcut) {
      this.menu = `[${option.shortcut}]`
    } else {
      this.menu = `[${option.name.slice(0, 5)}]`
    }
    this.disabled = false
  }
  public checkFileType(filetype: string):boolean {
    if (this.filetypes == null) return true
    return this.filetypes.indexOf(filetype) !== -1
  }

  public abstract shouldComplete(opt: CompleteOption): Promise<boolean>

  public abstract doComplete(opt: CompleteOption): Promise<CompleteResult>
}
