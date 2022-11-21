'use strict'
import { ASCII_END } from './constants'

export function getCharCodes(str: string): Uint16Array {
  let len = str.length
  let res = new Uint16Array(len)
  for (let i = 0, l = len; i < l; i++) {
    res[i] = str.charCodeAt(i)
  }
  return res
}

export function wordChar(ch: number): boolean {
  return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90)
}

export function caseMatch(input: number, code: number, ignorecase = false): boolean {
  if (input === code) return true
  if (code < ASCII_END) {
    if (input >= 97 && input <= 122 && code + 32 === input) return true
    if (ignorecase) {
      if (input <= 90 && input + 32 === code) return true
      if (toLower(input) === code) return true
    }
  } else {
    let lower = toLower(code)
    if (lower === input || (ignorecase && toLower(input) === lower)) return true
  }
  return false
}

function toLower(code: number): number {
  return String.fromCharCode(code).toLowerCase().charCodeAt(0)
}

export function fuzzyChar(a: string, b: string, ignorecase = false): boolean {
  let ca = a.charCodeAt(0)
  let cb = b.charCodeAt(0)
  return caseMatch(ca, cb, ignorecase)
}

// upper case must match, lower case ignore case
export function fuzzyMatch(needle: ArrayLike<number>, text: string, ignorecase = false): boolean {
  let totalCount = needle.length
  let tl = text.length
  if (totalCount > tl) return false
  let i = 0
  let curr = needle[0]
  for (let j = 0; j < tl; j++) {
    let code = text.charCodeAt(j)
    if (caseMatch(curr, code, ignorecase)) {
      i = i + 1
      curr = needle[i]
      if (i === totalCount) return true
      continue
    }
    if (tl - j - 1 < totalCount - i) {
      break
    }
  }
  return false
}
