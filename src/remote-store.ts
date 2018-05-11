import {VimCompleteItem} from './types'
import watchObj from './util/watch-obj'
const logger = require('./util/logger')('remote-store')

export interface Cached {
  [index: string]: VimCompleteItem[]
}

const timeout = 2000
const cached: Cached = {}
let {watched, addWatcher} = watchObj(cached)

export default {
  getResult(id: number, name: string):Promise<VimCompleteItem[]> {
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
        resolve(obj)
      })
      setTimeout(() => {
        remove()
        reject(new Error(`Source ${name} timeout in ${timeout/1000}s`))
      }, timeout)
    })
  },
  setResult(id: number, name: string, res: VimCompleteItem[]):void {
    let key= `${id}-${name}`
    watched[key] = res
  }
}
