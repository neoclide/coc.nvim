import fuzzysearch = require('fuzzysearch')

export function filterFuzzy(input: string, word: string, icase: boolean):boolean {
  if (!icase) return fuzzysearch(input, word)
  return fuzzysearch(input.toLowerCase(), word.toLowerCase())
}

export function filterWord(input: string, word: string, icase: boolean):boolean {
  if (!icase) return word.startsWith(input)
  return word.toLowerCase().startsWith(input.toLowerCase())
}
