import {CompleteOption, CompleteResult} from '../types'
import remoteStore from '../remote-store'
import {getConfig} from '../config'
import Source from './source'
import {filterItemWord, filterItemFuzzy} from '../util/filter'
import {echoErr, echoWarning} from '../util/index'
import {logger} from '../util/logger'

export default class VimSource extends Source {

  private async echoError(str: string):Promise<void> {
    await echoErr(this.nvim, `Vim error from source ${this.name}: ${str}`)
  }

  private async callOptinalFunc(fname: string, args: any[]):Promise<any> {
    let exists = this.optionalFns.indexOf(fname) !== -1
    if (!exists) return null
    let name = `complete#source#${this.name}#${fname}`
    let res
    try {
      res = await this.nvim.call(name, args)
    } catch (e) {
      await this.echoError(e.message)
      return null
    }
    return res
  }

  public async shouldComplete(opt: CompleteOption):Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let res = await this.callOptinalFunc('should_complete', [opt])
    return !!res
  }

  public async refresh():Promise<void> {
    await this.callOptinalFunc('refresh', [])
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let {colnr, col, id, input} = opt
    let startcol:number | null = await this.callOptinalFunc('get_startcol', [opt])
    if (startcol) {
      startcol = Number(startcol)
      // invalid startcol
      if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
      if (startcol !== col) {
        opt = Object.assign({}, opt, {col: startcol})
      }
    }
    await this.nvim.call('complete#remote#do_complete', [this.name, opt])
    let items = await remoteStore.getResult(id, this.name)
    let filter = getConfig('filter')
    for (let item of items) {
      // not use these
      delete item.dup
      delete item.icase
      if (item.menu && !item.info) {
        item.info = item.menu
      }
      item.menu = this.menu
    }
    if (items.length) {
      if (filter === 'word') {
        items = filterItemWord(items, input)
      } else {
        items = filterItemFuzzy(items, input)
      }
    }
    let res: CompleteResult = { items }
    if (startcol !== col && items.length != 0) {
      res.startcol = startcol
      res.engross = true
    }
    return res
  }
}
