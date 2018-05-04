import {filter} from 'fuzzaldrin'

export function filterWord(words: string[], input: string): string[] {
  let len = input.length
  return words.filter(w => w.slice(0, len).toLowerCase() === input.toLowerCase())
}

export function filterFuzzy(words: string[], input: string): string[] {
  if (input.length === 1) return filterWord(words, input)
  return filter(words, input)
}
