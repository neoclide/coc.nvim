import {Neovim} from 'neovim'
const logger = require('./util/logger')('input')

export default class Input {
  public input: string
  public word: string
  public positions: number[]
  private linenr: number
  private nvim:Neovim
  private startcol: number
  private match?: number

  constructor(nvim:Neovim, linenr, input: string, word: string, startcol: number) {
    let positions = []
    let index = 0
    for (let i = 0, l = input.length; i < l; i++) {
      let ch = input[i]
      while (index < word.length) {
        if (word[index].toLowerCase() == ch.toLowerCase()) {
          positions.push(index)
          break
        }
        index++
      }
    }
    this.linenr = linenr
    this.word = word
    this.nvim = nvim
    this.startcol = startcol
    this.input = input
    this.positions = positions
  }

  public async highlight():Promise<void> {
    await this.clear()
    let plist = this.getMatchPos()
    if (plist.length) {
      this.match = await this.nvim.call('matchaddpos', ['CocChars', plist, 99])
    }
  }

  public async removeCharactor():Promise<boolean> {
    let {word, input} = this
    if (!input.length) return true
    let {positions} = this
    if (positions.length) {
      positions.pop()
      this.input = this.input.slice(0, -1)
      this.word = word.slice(0, -1)
      await this.highlight()
    }
    if (positions.length == 0) return true
  }

  public async addCharactor(c: string):Promise<void> {
    this.input = this.input + c
    this.word = this.word + c
    this.positions.push(this.word.length - 1)
    await this.highlight()
  }

  private getMatchPos():number[][] {
    let {startcol, positions, linenr} = this
    return positions.map(p => {
      return [linenr, startcol + p + 1]
    })
  }

  public async clear():Promise<void> {
    if (this.match) {
      await this.nvim.call('matchdelete', [this.match])
      this.match = null
    }
  }
}
