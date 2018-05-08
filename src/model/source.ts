import { Neovim } from 'neovim'
import {getSourceConfig} from '../config'
import {SourceOption,
  CompleteOption,
  CompleteResult} from '../types'

export default abstract class Source {
  public readonly name: string
  public shortcut?: string
  public filetypes: string[] | null | undefined
  public engross: boolean
  public priority: number
  protected readonly nvim: Neovim
  constructor(nvim: Neovim, option: SourceOption) {
    let {shortcut, filetypes, name, priority}  = option
    this.nvim = nvim
    this.name = name
    this.priority = priority || 0
    this.engross = !!option.engross
    let opt = getSourceConfig(name) || {}
    shortcut = opt.shortcut || shortcut
    this.filetypes = opt.filetypes || Array.isArray(filetypes) ? filetypes : null
    this.shortcut = shortcut ? shortcut.slice(0, 3) : name.slice(0, 3)
  }

  public get menu():string {
    return `[${this.shortcut.toUpperCase()}]`
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

  public abstract doComplete(opt: CompleteOption): Promise<CompleteResult>
}
