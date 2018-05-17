import {Neovim} from 'neovim'
import {getConfig} from '../config'

export default class Input {
  public search: string
  private linenr: number
  private nvim:Neovim
  private startcol: number
  private match?: number

  constructor(nvim:Neovim, search: string, linenr:number, startcol: number) {
    this.nvim = nvim
    this.linenr = linenr
    this.startcol = startcol
    this.search = search
  }

  public async highlight():Promise<void> {
    let enabled = getConfig('incrementHightlight')
    if (!enabled) return
    await this.clear()
    if (this.search.length) {
      let plist = this.getMatchPos()
      this.match = await this.nvim.call('matchaddpos', ['CocChars', plist, 99])
    }
  }

  public async removeCharactor():Promise<boolean> {
    let {search} = this
    let l = search.length
    if (l == 0) return true
    this.search = this.search.slice(0, -1)
    await this.highlight()
    return false
  }

  public async addCharactor(c: string):Promise<void> {
    this.search = this.search + c
    await this.highlight()
  }

  private getMatchPos():number[][] {
    let {startcol, search, linenr} = this
    let range = Array.apply(null, Array(search.length)).map((_, i)=> i)
    return range.map(p => {
      return [linenr, startcol + p + 1]
    })
  }

  public async clear():Promise<void> {
    if (this.match) {
      await this.nvim.command(`silent! call matchdelete(${this.match})`)
      this.match = null
    }
  }
}
