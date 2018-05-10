import {CompleteOption, CompleteResult} from '../types'
import remoteStore from '../remote-store'
import {getConfig} from '../config'
import Source from './source'
import {filterItemWord, filterItemFuzzy} from '../util/filter'
import {echoErr, echoWarning} from '../util/index'
import {logger} from '../util/logger'

export default class VimSource extends Source {

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let name = `complete#source#${this.name}#should_complete`
    let exists = await this.nvim.call('exists', [`*${name}`])
    if (exists == 1) {
      let res = 0
      try {
        res = await this.nvim.call(name, [opt])
      } catch (e) {
        await this.echoError(e.message)
        return false
      }
      return res == 1
    }
    return true
  }

  public async refresh():Promise<void> {
    let name = `complete#source#${this.name}#refresh`
    let exists = await this.nvim.call('exists', [`*${name}`])
    if (exists == 1) {
      try {
        await this.nvim.call(name, [])
      } catch (e) {
        await this.echoError(e.message)
      }
    } else {
      await echoWarning(this.nvim, `No refresh method defiend for ${name}`)
    }
  }

  private async echoError(str: string):Promise<void> {
    await echoErr(this.nvim, `Vim error from source ${this.name}: ${str}`)
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let {colnr, col, id, input} = opt
    let fn = `complete#source#${this.name}#get_startcol`
    let exists = await this.nvim.call('exists', [`*${fn}`])
    let startcol:number | null = null
    if (exists == 1) {
      try {
        startcol = await this.nvim.call(fn, [opt])
        startcol = Number(startcol)
        if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
      } catch (e) {
        await this.echoError(e.message)
        return null
      }
    }
    if (startcol && startcol !== col) {
      opt = Object.assign({}, opt, {col: startcol})
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
    if (startcol !== col) {
      res.startcol = startcol
      res.engross = items.length != 0
    }
    return res
  }
}
