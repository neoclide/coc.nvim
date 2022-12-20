'use strict'
import type { Range } from 'vscode-languageserver-types'
import { intable } from './array'
import { CharCode } from './charCode'

const UTF8_2BYTES_START = 0x80
const UTF8_3BYTES_START = 0x800
const UTF8_4BYTES_START = 65536
const encoding = 'utf8'
const asciiTable: ReadonlyArray<[number, number]> = [
  [48, 57],
  [65, 90],
  [97, 122]
]

export function toErrorText(error: any): string {
  return error instanceof Error ? error.message : error.toString()
}

export function toInteger(text: string): number | undefined {
  let n = parseInt(text, 10)
  return isNaN(n) ? undefined : n
}

export function toText(text: string | null | undefined): string {
  return text ?? ''
}

export function toBase64(text: string) {
  return global.Buffer.from(text).toString('base64')
}

export function isHighlightGroupCharCode(code: number): boolean {
  if (intable(code, asciiTable)) return true
  return code === CharCode.Underline || code === CharCode.Period || code === CharCode.AtSign
}

/**
 * A fast function (therefore imprecise) to check if code points are emojis.
 * Generated using https://github.com/alexdima/unicode-utils/blob/main/emoji-test.js
 */
export function isEmojiImprecise(x: number): boolean {
  return (
    (x >= 0x1F1E6 && x <= 0x1F1FF) || (x === 8986) || (x === 8987) || (x === 9200)
    || (x === 9203) || (x >= 9728 && x <= 10175) || (x === 11088) || (x === 11093)
    || (x >= 127744 && x <= 128591) || (x >= 128640 && x <= 128764)
    || (x >= 128992 && x <= 129008) || (x >= 129280 && x <= 129535)
    || (x >= 129648 && x <= 129782)
  )
}

/**
 * Get previous and after part of range
 */
export function rangeParts(text: string, range: Range): [string, string] {
  let { start, end } = range
  let lines = text.split(/\r?\n/)
  let before = ''
  let after = ''
  let len = lines.length
  // get start and end parts
  for (let i = 0; i < len; i++) {
    let curr = lines[i]
    if (i < start.line) {
      before += curr + '\n'
      continue
    }
    if (i > end.line) {
      after += curr + (i == len - 1 ? '' : '\n')
      continue
    }
    if (i == start.line) {
      before += curr.slice(0, start.character)
    }
    if (i == end.line) {
      after += curr.slice(end.character) + (i == len - 1 ? '' : '\n')
    }
  }
  return [before, after]
}

// lowerCase 1, upperCase 2
export function getCase(code: number): number {
  if (code >= 97 && code <= 122) return 1
  if (code >= 65 && code <= 90) return 2
  return 0
}

export function getNextWord(codes: Uint16Array, index: number): [number, number] | undefined {
  let preCase = index == 0 ? 0 : getCase(codes[index - 1])
  for (let i = index; i < codes.length; i++) {
    let curr = getCase(codes[i])
    if (curr > 0 && curr != preCase) {
      return [i, codes[i]]
    }
    preCase = curr
  }
  return undefined
}

export function getCharIndexes(input: string, character: string): number[] {
  let res: number[] = []
  for (let i = 0; i < input.length; i++) {
    if (input[i] == character) res.push(i)
  }
  return res
}

export function isHighSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdbff
}

export function isLowSurrogate(codePoint: number): boolean {
  return codePoint >= 0xdc00 && codePoint <= 0xdfff
}

/**
 * Get byte length from string, from code unit start index.
 */
export function byteLength(str: string, start = 0): number {
  if (start === 0) return Buffer.byteLength(str, encoding)
  let len = 0
  let unitIndex = 0
  for (let codePoint of str) {
    let n = codePoint.codePointAt(0)
    if (unitIndex >= start) {
      len += utf8_code2len(n)
    }
    unitIndex += (n >= UTF8_4BYTES_START ? 2 : 1)
  }
  return len
}

/**
 * utf16 code unit to byte index.
 */
export function byteIndex(content: string, index: number): number {
  let byteLength = 0
  let codePoint: number | undefined
  let prevCodePoint: number | undefined
  let max = Math.min(index, content.length)
  for (let i = 0; i < max; i++) {
    codePoint = content.charCodeAt(i)
    if (isLowSurrogate(codePoint)) {
      if (prevCodePoint && isHighSurrogate(prevCodePoint)) {
        byteLength += 1
      } else {
        byteLength += 3
      }
    } else {
      byteLength += utf8_code2len(codePoint)
    }
    prevCodePoint = codePoint
  }
  return byteLength
}

export function upperFirst(str: string): string {
  return str?.length > 0 ? str[0].toUpperCase() + str.slice(1) : ''
}

export function indexOf(str: string, ch: string, count = 1): number {
  let curr = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i] == ch) {
      curr = curr + 1
      if (curr == count) {
        return i
      }
    }
  }
  return -1
}

export function characterIndex(content: string, byteIndex: number): number {
  if (byteIndex == 0) return 0
  let characterIndex = 0
  let total = 0
  for (let codePoint of content) {
    let code = codePoint.codePointAt(0)
    if (code >= UTF8_4BYTES_START) {
      characterIndex += 2
      total += 4
    } else {
      characterIndex += 1
      total += utf8_code2len(code)
    }
    if (total >= byteIndex) break
  }
  return characterIndex
}

export function utf8_code2len(code: number): number {
  if (code < UTF8_2BYTES_START) return 1
  if (code < UTF8_3BYTES_START) return 2
  if (code < UTF8_4BYTES_START) return 3
  return 4
}

/**
 * No need to create Buffer
 */
export function byteSlice(content: string, start: number, end?: number): string {
  let si = characterIndex(content, start)
  let ei = end === undefined ? undefined : characterIndex(content, end)
  return content.slice(si, ei)
}

export function isAlphabet(code: number): boolean {
  if (code >= 65 && code <= 90) return true
  if (code >= 97 && code <= 122) return true
  return false
}

export function doEqualsIgnoreCase(a: string, b: string, stopAt = a.length): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }
  for (let i = 0; i < stopAt; i++) {
    const codeA = a.charCodeAt(i)
    const codeB = b.charCodeAt(i)
    if (codeA === codeB) {
      continue
    }
    // a-z A-Z
    if (isAlphabet(codeA) && isAlphabet(codeB)) {
      const diff = Math.abs(codeA - codeB)
      if (diff !== 0 && diff !== 32) {
        return false
      }
    }
    // Any other charcode
    else {
      if (String.fromCharCode(codeA).toLowerCase() !== String.fromCharCode(codeB).toLowerCase()) {
        return false
      }
    }
  }
  return true
}

export function equalsIgnoreCase(a: string, b: string): boolean {
  const len1 = a ? a.length : 0
  const len2 = b ? b.length : 0
  if (len1 !== len2) return false
  return doEqualsIgnoreCase(a, b)
}

export function contentToLines(content: string, eol: boolean): string[] {
  if (eol && content.endsWith('\n')) {
    return content.slice(0, -1).split('\n')
  }
  return content.split('\n')
}

function hasUpperCase(str: string): boolean {
  for (let i = 0, l = str.length; i < l; i++) {
    let code = str.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      return true
    }
  }
  return false
}

function smartMatch(a: string, b: string): boolean {
  if (a === b) return true
  let c = b.charCodeAt(0)
  if (c >= 65 && c <= 90) {
    if (c + 32 === a.charCodeAt(0)) return true
  }
  return false
}

// check if string smartcase include the other string
export function smartcaseIndex(input: string, other: string): number {
  if (input.length > other.length) return -1
  if (input.length === 0) return 0
  if (!hasUpperCase(input)) {
    return other.toLowerCase().indexOf(input)
  }
  let total = input.length
  let checked = 0
  for (let i = 0; i < other.length; i++) {
    let ch = other[i]
    if (smartMatch(input[checked], ch)) {
      checked++
      if (checked === total) {
        return i - checked + 1
      }
    } else if (checked > 0) {
      i = i - checked
      checked = 0
    }
  }
  return -1
}

/**
 * For faster convert sequence utf16 character index to byte index
 */
export function bytes(text: string, max?: number): (characterIndex: number) => number {
  max = max ?? text.length
  let lens = new Uint8Array(max)
  let ascii = true
  let prevCodePoint: number | undefined
  for (let i = 0; i < max; i++) {
    let code = text.charCodeAt(i)
    let len: number
    if (isLowSurrogate(code)) {
      if (prevCodePoint && isHighSurrogate(prevCodePoint)) {
        len = 1
      } else {
        len = 3
      }
    } else {
      len = utf8_code2len(code)
    }
    if (ascii && len > 1) ascii = false
    lens[i] = len
    prevCodePoint = code
  }
  return characterIndex => {
    if (characterIndex === 0) return 0
    if (ascii) return Math.min(characterIndex, max)
    let res = 0
    for (let i = 0; i < Math.min(characterIndex, max); i++) {
      res += lens[i]
    }
    return res
  }
}
