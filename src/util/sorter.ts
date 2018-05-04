import {score} from 'fuzzaldrin'

export function fuzzySort(words: string[], input: string): string[] {
  return words.sort((a, b) => {
    return score(b, input) - score(a, input)
  })
}
