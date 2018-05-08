import {VimCompleteItem} from '../types'
import {filter} from 'fuzzaldrin'
import fuzzysearch = require('fuzzysearch')

export function filterItemWord(items: VimCompleteItem[], input:string): VimCompleteItem[] {
  let len = input.length
  let s = input.toLowerCase()
  return items.filter(item => {
    return item.word.slice(0, len).toLowerCase() === s
  })
}

export function filterItemFuzzy(items: VimCompleteItem[], input:string): VimCompleteItem[] {
  return filter(items, input, {key: 'word'})
}

export function filterFuzzy(input: string, word: string, icase: boolean):boolean {
  if (!icase) return fuzzysearch(input, word)
  return fuzzysearch(input.toLowerCase(), word.toLowerCase())
}

export function filterWord(input: string, word: string, icase: boolean):boolean {
  if (!icase) return word.startsWith(input)
  return word.toLowerCase().startsWith(input.toLowerCase())
}
