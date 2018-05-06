/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {VimCompleteItem} from './types'
import watchObj from './util/watch-obj'
import {logger} from './util/logger'

export interface Cached {
  [index: string]: VimCompleteItem[]
}

const timeout = 5000
const cached: Cached = {}
let {watched, addWatcher} = watchObj(cached)

export default {
  getResult(id: string, name: string):Promise<VimCompleteItem[]> {
    let key= `${id}-${name}`
    let res = cached[key]
    if (res) {
      delete cached[key]
      return Promise.resolve(res)
    }
    // wait for received data
    return new Promise((resolve, reject):void => {
      let remove:any = addWatcher(key, obj => {
        delete cached[key]
        logger.debug(JSON.stringify(obj))
        resolve(obj)
      })
      setTimeout(() => {
        remove()
        reject(new Error(`Source ${name} timeout in ${timeout/5000}s`))
      }, timeout)
    })
  },
  setResult(id: string, name: string, res: VimCompleteItem[]):void {
    let key= `${id}-${name}`
    watched[key] = res
  }
}
