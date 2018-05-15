import {VimCompleteItem} from '../types'

export function wordSortItems(items: VimCompleteItem[], input?: string): VimCompleteItem[] {
  return items.sort((a, b) => {
    let wa = (a.abbr || a.word).toLowerCase()
    let wb = (b.abbr || b.word).toLowerCase()
    if (wa < wb) {
      return - 1
    }
    if (wa > wb) {
      return 1
    }
    return 0
  })
}
