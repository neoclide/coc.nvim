import {VimCompleteItem} from '../types'

export function uniqueItems(results: VimCompleteItem[]):VimCompleteItem[] {
  return results.filter((item, index) => {
    let {word, kind, info, abbr} = item
    let better = results.find((obj, idx) => {
      // optimized for css omni
      if (obj.word !== word) return obj.word.replace(/[:;]\s?$/, '') === word
      if (!kind && obj.kind) return true
      if (!info && obj.info) return true
      if (!abbr && obj.abbr) return true
      return idx < index
    })
    return better == null ? true : false
  })
}
