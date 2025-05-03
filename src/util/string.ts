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

export function toText(text: string | number | null | undefined): string {
  if (typeof text === 'number') return text.toString()
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

export function* iterateCharacter(input: string, character: string): Iterable<number> {
  for (let i = 0; i < input.length; i++) {
    if (input[i] == character) yield i
  }
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

/**
 * Unicode class.
 */
export type UnicodeClass =
  | "ascii"
  | "punctuation"
  | "space"
  | "word"
  | "hiragana"
  | "katakana"
  | "cjkideograph"
  | "hangulsyllable"
  | "superscript"
  | "subscript"
  | "braille"
  | "other"

// Unicode class ranges. This list is based on Neovim's classification.
// reference: https://github.com/neovim/neovim/blob/052e048db676ef3e68efc497c02902e3d43e6255/src/nvim/mbyte.c#L1229-L1305
const nonAsciiUnicodeClassRanges = [
  [0x037e, 0x037e, "punctuation"],
  [0x0387, 0x0387, "punctuation"],
  [0x055a, 0x055f, "punctuation"],
  [0x0589, 0x0589, "punctuation"],
  [0x05be, 0x05be, "punctuation"],
  [0x05c0, 0x05c0, "punctuation"],
  [0x05c3, 0x05c3, "punctuation"],
  [0x05f3, 0x05f4, "punctuation"],
  [0x060c, 0x060c, "punctuation"],
  [0x061b, 0x061b, "punctuation"],
  [0x061f, 0x061f, "punctuation"],
  [0x066a, 0x066d, "punctuation"],
  [0x06d4, 0x06d4, "punctuation"],
  [0x0700, 0x070d, "punctuation"],
  [0x0964, 0x0965, "punctuation"],
  [0x0970, 0x0970, "punctuation"],
  [0x0df4, 0x0df4, "punctuation"],
  [0x0e4f, 0x0e4f, "punctuation"],
  [0x0e5a, 0x0e5b, "punctuation"],
  [0x0f04, 0x0f12, "punctuation"],
  [0x0f3a, 0x0f3d, "punctuation"],
  [0x0f85, 0x0f85, "punctuation"],
  [0x104a, 0x104f, "punctuation"],
  [0x10fb, 0x10fb, "punctuation"],
  [0x1361, 0x1368, "punctuation"],
  [0x166d, 0x166e, "punctuation"],
  [0x1680, 0x1680, "space"],
  [0x169b, 0x169c, "punctuation"],
  [0x16eb, 0x16ed, "punctuation"],
  [0x1735, 0x1736, "punctuation"],
  [0x17d4, 0x17dc, "punctuation"],
  [0x1800, 0x180a, "punctuation"],
  [0x2000, 0x200b, "space"],
  [0x200c, 0x2027, "punctuation"],
  [0x2028, 0x2029, "space"],
  [0x202a, 0x202e, "punctuation"],
  [0x202f, 0x202f, "space"],
  [0x2030, 0x205e, "punctuation"],
  [0x205f, 0x205f, "space"],
  [0x2060, 0x27ff, "punctuation"],
  [0x2070, 0x207f, "superscript"],
  [0x2080, 0x2094, "subscript"],
  [0x20a0, 0x27ff, "punctuation"],
  [0x2800, 0x28ff, "braille"],
  [0x2900, 0x2998, "punctuation"],
  [0x29d8, 0x29db, "punctuation"],
  [0x29fc, 0x29fd, "punctuation"],
  [0x2e00, 0x2e7f, "punctuation"],
  [0x3000, 0x3000, "space"],
  [0x3001, 0x3020, "punctuation"],
  [0x3030, 0x3030, "punctuation"],
  [0x303d, 0x303d, "punctuation"],
  [0x3040, 0x309f, "hiragana"],
  [0x30a0, 0x30ff, "katakana"],
  [0x3300, 0x9fff, "cjkideograph"],
  [0xac00, 0xd7a3, "hangulsyllable"],
  [0xf900, 0xfaff, "cjkideograph"],
  [0xfd3e, 0xfd3f, "punctuation"],
  [0xfe30, 0xfe6b, "punctuation"],
  [0xff00, 0xff0f, "punctuation"],
  [0xff1a, 0xff20, "punctuation"],
  [0xff3b, 0xff40, "punctuation"],
  [0xff5b, 0xff65, "punctuation"],
  [0x1d000, 0x1d24f, "other"],
  [0x1d400, 0x1d7ff, "other"],
  [0x1f000, 0x1f2ff, "other"],
  [0x1f300, 0x1f9ff, "other"],
  [0x20000, 0x2a6df, "cjkideograph"],
  [0x2a700, 0x2b73f, "cjkideograph"],
  [0x2b740, 0x2b81f, "cjkideograph"],
  [0x2f800, 0x2fa1f, "cjkideograph"],
] as const

/**
 * Get class of a Unicode character.
 */
export function getUnicodeClass(char: string): UnicodeClass {
  if (char == null || char.length === 0) return "other"

  const charCode = char.charCodeAt(0)
  // Check for ASCII character
  if (charCode <= 0x7f) {
    if (charCode === 0) return "other"
    if (/\s/.test(char)) return "space"
    if (/\w/.test(char)) return "word"
    return "punctuation"
  }

  for (const [start, end, category] of nonAsciiUnicodeClassRanges) {
    if (start <= charCode && charCode <= end) {
      return category
    }
  }

  return "other"
}
