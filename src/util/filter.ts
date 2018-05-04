import {VimCompleteItem} from '../types'
import {filter} from 'fuzzaldrin'

export function filterWord(words: string[], input: string): string[] {
  let len = input.length
  return words.filter(w => w.slice(0, len).toLowerCase() === input.toLowerCase())
}

export function filterFuzzy(words: string[], input: string): string[] {
  if (input.length === 1) return filterWord(words, input)
  return filter(words, input)
}

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
