/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {CompleteOption, CompleteResult} from '../types'
import remoteStore from '../remote-store'
import Source from './source'

export default class VimSource extends Source {
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let name = `complete#source#${this.name}#should_complete`
    let exists = await this.nvim.call('exists', [`*${name}`])
    if (exists == 1) {
      let res = await this.nvim.call(name, [opt])
      return res === 1
    }
    return true
  }
  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    await this.nvim.call('complete#complete_source', [this.name, opt])
    let {id} = opt
    let res = await remoteStore.getResult(id, this.name)
    return res
  }
}
