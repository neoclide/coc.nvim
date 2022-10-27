'use strict'
import { Range } from 'vscode-languageserver-protocol'

const UTF8_2BYTES_START = 0x80
const UTF8_3BYTES_START = 0x800
const UTF8_4BYTES_START = 65536

export function toInteger(text: string): number | undefined {
  let n = parseInt(text, 10)
  return isNaN(n) ? undefined : n
}

export function toText(text: string | null | undefined): string {
  return text ?? ''
}

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

// nvim use utf8
export function byteLength(str: string): number {
  return Buffer.byteLength(str)
}

export function upperFirst(str: string): string {
  return str?.length > 0 ? str[0].toUpperCase() + str.slice(1) : ''
}

/**
 * utf16 code unit to byte index.
 */
export function byteIndex(content: string, index: number): number {
  return Buffer.byteLength(content.slice(0, index), 'utf8')
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
  let ei = characterIndex(content, end)
  return content.slice(si, ei)
}

export function isWord(character: string): boolean {
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code == 95) return true
  if (code >= 48 && code <= 57) return true
  if (isAlphabet(code)) return true
  return false
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
export default function bytes(text: string, max?: number): (characterIndex: number) => number {
  max = max ?? text.length
  let arr = new Uint8Array(max)
  let ascii = true
  for (let i = 0; i < max; i++) {
    let l = utf8_code2len(text.charCodeAt(i))
    if (l > 1) ascii = false
    arr[i] = l
  }
  return characterIndex => {
    if (characterIndex === 0) return 0
    if (ascii) return Math.min(characterIndex, max)
    let res = 0
    for (let i = 0; i < Math.min(characterIndex, max); i++) {
      res += arr[i]
    }
    return res
  }
}
