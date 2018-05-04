/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {CompleteOption, CompleteResult} from '../types'
import remoteStore from '../remote-store'
import Source from './source'
import {filterItemWord, filterItemFuzzy} from '../util/filter'
import {logger} from '../util/logger'

export default class VimSource extends Source {

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let name = `complete#source#${this.name}#should_complete`
    let exists = await this.nvim.call('exists', [`*${name}`])
    if (exists == 1) {
      let res = await this.nvim.call(name, [opt])
      return res == 1
    }
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let fn = `complete#source#${this.name}#get_offset`
    let exists = await this.nvim.call('exists', [`*${fn}`])
    let offsets: null | {offsetLeft: number, offsetRight: number} = null
    if (exists == 1) {
      offsets = await this.nvim.call(fn, [opt])
    }
    await this.nvim.call('complete#remote#do_complete', [this.name, opt])
    let {id, input} = opt
    let items = await remoteStore.getResult(id, this.name)
    let filter = this.getFilter()
    for (let item of items) {
      item.menu = this.menu
    }
    if (filter === 'fuzzy') {
      items = filterItemFuzzy(items, input)
    } else if (filter === 'word') {
      items = filterItemWord(items, input)
    }
    let res: CompleteResult = { items }
    if (offsets) {
      res.offsetLeft = offsets.offsetLeft || 0
      res.offsetRight = offsets.offsetRight || 0
    }
    return res
  }
}
