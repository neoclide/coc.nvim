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
    let fn = `complete#source#${this.name}#get_offset`
    let exists = await this.nvim.call('exists', [`*${fn}`])
    let offsets: null | {offsetLeft: number, offsetRight: number} = null
    if (exists == 1) {
      try {
        offsets = await this.nvim.call(fn, [opt])
      } catch (e) {
        await this.echoError(e.message)
        return null
      }
    }
    await this.nvim.call('complete#remote#do_complete', [this.name, opt])
    let {id, input} = opt
    let items = await remoteStore.getResult(id, this.name)
    let filter = getConfig('filter')
    for (let item of items) {
      // not use these
      delete item.dup
      delete item.icase
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
    if (offsets) {
      res.offsetLeft = offsets.offsetLeft || 0
      res.offsetRight = offsets.offsetRight || 0
    }
    return res
  }
}
