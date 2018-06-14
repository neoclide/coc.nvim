import {Neovim} from 'neovim'
import workspace from '../workspace'

export default class Input {

  constructor(
    private nvim:Neovim,
    public search:string,
    private linenr:number,
    private startcol:number,
    private highlightId:number) {
  }

  public async highlight():Promise<void> {
    let enabled = workspace.getConfiguration('coc.preferences').get('enableHighlight', false)
    if (!enabled) return
    await this.clear()
    if (this.search.length) {
      let {linenr, highlightId, startcol, search} = this
      // let buffer = await this.nvim.buffer
      let buffer = await this.nvim.buffer
      await buffer.addHighlight({
        hlGroup: 'CocChars',
        line: linenr - 1,
        srcId: highlightId,
        colStart: startcol,
        colEnd: startcol + search.length
      })
    }
  }

  public async clear():Promise<void> {
    let {highlightId} = this
    let buffer = await this.nvim.buffer
    await buffer.clearHighlight({ srcId: highlightId })
  }

  public async removeCharactor():Promise<void> {
    let {search} = this
    let l = search.length
    if (l == 0) return
    this.search = this.search.slice(0, -1)
    await this.highlight()
  }

  public async addCharacter(c:string):Promise<void> {
    this.search = this.search + c
    await this.highlight()
  }

  public async changeSearch(str:string):Promise<void> {
    this.search = str
    await this.highlight()
  }

}
