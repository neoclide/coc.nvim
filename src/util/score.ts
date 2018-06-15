
/**
 * Scores a target string against a query string.
 * @param  {String} target      The target string to score the query against.
 * @param  {String} query       The query to score against the target string.
 * @param  {Number} fuzzyFactor Optional. A number between 0 and 1 which increases scores of non-perfect matches.
 * @return {Number}             A number between 0 and 1. 0 being no match and 1 being perfect match.
 */
export default function(target:string, query:string, fuzzyFactor?:number):number {
  // If the string is equal to the word, perfect match.
  if (target === query) {
    return 1
  }

  // If it's not a perfect match and is empty return 0.
  if (query === '') {
    return 0
  }

  let runningScore = 0
  let targetLower = target.toLowerCase()
  let targetLen = target.length
  let queryLower = query.toLowerCase()
  let queryLen = query.length
  let startAt = 0
  let fuzzies = 1

  // Calculate fuzzy factor
  fuzzyFactor = fuzzyFactor ? 1 - fuzzyFactor : 0

  // Walk through query and add up scores.
  // Code duplication occurs to prevent checking fuzziness inside for loop
  for (let i = 0; i < queryLen; i+=1) {
    // Find next first case-insensitive match of a character.
    let idxOf = targetLower.indexOf(queryLower[i], startAt)

    if (idxOf === -1) {
      if (fuzzyFactor) {
        fuzzies += fuzzyFactor
      } else {
        return 0
      }
    } else {
      let charScore = 0
      if (startAt === idxOf) {
        // Consecutive letter & start-of-string Bonus
        charScore = 0.7
      } else {
        charScore = 0.1

        // Acronym Bonus
        // Weighing Logic: Typing the first character of an acronym is as if you
        // preceded it with two perfect character matches.
        if (target[idxOf - 1] === ' ') {
          charScore += 0.8
        }
      }

      // Same case bonus.
      if (target[idxOf] === query[i]) {
        charScore += 0.1
      }

      // Update scores and startAt position for next round of indexOf
      runningScore += charScore
      startAt = idxOf + 1
    }
  }

  // Reduce penalty for longer strings.
  let finalScore = 0.5 * (runningScore / targetLen + runningScore / queryLen) / fuzzies

  if ((queryLower[0] === targetLower[0]) && (finalScore < 0.85)) {
    finalScore += 0.15
  }

  return finalScore
}
