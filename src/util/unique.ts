import {VimCompleteItem} from '../types'

export function uniqueItems(results: VimCompleteItem[]):VimCompleteItem[] {
  return results.filter(item => {
    let {word, kind, info, abbr} = item
    let better = results.find(obj => {
      if (obj.word !== word) return false
      if (!kind && obj.kind) return true
      if (!info && obj.info) return true
      if (!abbr && obj.abbr) return true
      return false
    })
    return better == null ? true : false
  })
}
