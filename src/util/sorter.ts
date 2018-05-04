import {VimCompleteItem} from '../types'
import {score} from 'fuzzaldrin'

export function fuzzySort(words: string[], input: string): string[] {
  return words.sort((a, b) => {
    return score(b, input) - score(a, input)
  })
}

export function wordSort(words: string[], input?: string): string[] {
  return words.sort()
}

export function fuzzySortItems(items: VimCompleteItem[], input: string): VimCompleteItem[] {
  return items.sort((a, b) => {
    return score(b.word, input) - score(a.word, input)
  })
}

export function wordSortItems(items: VimCompleteItem[], input?: string): VimCompleteItem[] {
  return items.sort((a, b) => {
    let wa = a.word.toLowerCase()
    let wb = b.word.toLowerCase()
    if (wa < wb) {
      return - 1
    }
    if (wa > wb) {
      return 1
    }
    return 0
  })
}
