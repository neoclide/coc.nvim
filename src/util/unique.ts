import {VimCompleteItem} from '../types'

function fieldCompare(one:string | null, other:string | null):boolean {
  if (one && !other) return true
  if (other && !one) return false
  return one > other
}

function isEqual(one:string | null | undefined, other:string|null|undefined):boolean {
  if (!one && !other) return true
  return one === other
}

export function uniqueItems(results: VimCompleteItem[]):VimCompleteItem[] {
  return results.filter((item, index) => {
    let {word, kind, info, abbr} = item
    let better = results.find((obj, idx) => {
      if (obj.word !== word) return false
      if (!isEqual(obj.kind, kind)) return fieldCompare(obj.kind, kind)
      if (!isEqual(obj.info, info)) return fieldCompare(obj.info, info)
      if (!isEqual(obj.abbr, abbr)) return fieldCompare(obj.abbr, abbr)
      return idx < index
    })
    return better == null ? true : false
  })
}

export function uniqeWordsList(list:string[][]):string[] {
  let res = []
  for (let item of list) {
    for (let word of item) {
      if (res.indexOf(word) === -1) {
        res.push(word)
      }
    }
  }
  return res
}
