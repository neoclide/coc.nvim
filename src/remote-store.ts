/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {CompleteResult} from './types'
import watchObj from './util/watch-obj'

export interface Cached {
  [index: string]: CompleteResult
}

const timeout = 1000
const cached: Cached = {}
let {watched, addWatcher} = watchObj(cached)

export default {
  getResult(id: string, name: string):Promise<CompleteResult> {
    let key= `${id}-${name}`
    let res = cached[key]
    if (res) {
      delete cached[key]
      return Promise.resolve(res)
    }
    return new Promise((resolve, reject):void => {
      addWatcher(key, obj => {
        called = true
        delete cached[key]
        resolve(obj)
      })
      let called = false
      setTimeout(() => {
        if (!called) {
          called = true
          reject(new Error(`Source ${name} timeout in ${timeout/1000}s`))
        }
      }, timeout)
    })
  },
  setResult(id: string, name: string, res: CompleteResult):void {
    let key= `${id}-${name}`
    watched[key] = res
  }
}
