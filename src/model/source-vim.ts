import remoteStore from '../remote-store'
import { CompleteOption, CompleteResult, VimCompleteItem, DocumentInfo } from '../types'
import { fuzzyChar } from '../util/fuzzy'
import { echoErr } from '../util/index'
import { byteSlice } from '../util/string'
import Source from './source'
const logger = require('../util/logger')('model-source-vim')

export default class VimSource extends Source {

  private async callOptinalFunc(fname: string, args: any[]): Promise<any> {
    let exists = this.optionalFns.indexOf(fname) !== -1
    if (!exists) return null
    let name = `coc#source#${this.name}#${fname}`
    let res
    try {
      res = await this.nvim.call(name, args)
    } catch (e) {
      echoErr(this.nvim, `Vim error from source ${this.name}: ${e.message}`)
      return null
    }
    return res
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (this.optionalFns.indexOf('should_complete') === -1) return true
    let res = await this.callOptinalFunc('should_complete', [opt])
    return !!res
  }

  public async refresh(): Promise<void> {
    await this.callOptinalFunc('refresh', [])
  }

  public async onCompleteDone(item: VimCompleteItem): Promise<void> {
    if (this.optionalFns.indexOf('on_complete') === -1) return
    this.callOptinalFunc('on_complete', [item]) // tslint:disable-line
  }

  public onEnter(info: DocumentInfo): void {
    if (this.optionalFns.indexOf('on_enter') === -1) return
    this.callOptinalFunc('on_enter', [info]) // tslint:disable-line
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let { col, id, input, line, colnr } = opt
    let startcol: number | null = await this.callOptinalFunc('get_startcol', [opt])
    if (startcol) {
      if (startcol < 0) return null
      startcol = Number(startcol)
      // invalid startcol
      if (isNaN(startcol) || startcol < 0) startcol = col
      if (startcol !== col) {
        input = byteSlice(line, startcol, colnr - 1)
        opt = Object.assign({}, opt, {
          col: startcol,
          changed: col - startcol,
          input
        })
      }
    }
    this.nvim.call('coc#remote#do_complete', [this.name, opt], true)
    let items = await remoteStore.getResult(id, this.name)
    if (!items) return null
    if (this.firstMatch && input.length) {
      let ch = input[0]
      items = items.filter(item => {
        let cfirst = item.filterText ? item.filterText[0] : item.word[0]
        return fuzzyChar(ch, cfirst)
      })
    }
    for (let item of items) {
      let menu = item.menu ? item.menu + ' ' : ''
      item.menu = `${menu}${this.menu}`
    }
    let res: CompleteResult = { items }
    res.startcol = startcol
    return res
  }
}
