import fs from 'fs'
import path from 'path'
import { AnsiHighlight } from '../types'
import bytes from '../util/string'

export interface FuzzyWasi {
  fuzzyMatch: (textPtr: number, patternPtr: number, resultPtr: number, matchSeq: 0 | 1) => number
  malloc: (size: number) => number
  free: (ptr: number) => void
  memory: {
    buffer: ArrayBuffer
  }
}

export interface MatchResult {
  score: number
  positions: Uint32Array
}

export interface MatchHighlights {
  score: number
  highlights: AnsiHighlight[]
}

export async function initFuzzyWasm(): Promise<FuzzyWasi> {
  const filePath = path.resolve(__dirname, global.__TEST__ ? '../..' : '..', 'bin/fuzzy.wasm')
  const buffer = fs.readFileSync(filePath)
  const res = await global.WebAssembly.instantiate(buffer, { env: {} })
  return res.instance.exports as FuzzyWasi
}

export function* matchSpans(text: string, positions: ArrayLike<number>, max?: number): Iterable<[number, number]> {
  max = max ? Math.min(max, text.length) : text.length
  let byteIndex = bytes(text, Math.min(text.length, 4096))
  let start: number | undefined
  let prev: number | undefined
  let len = positions.length
  for (let i = 0; i < len; i++) {
    let curr = positions[i]
    if (curr >= max) {
      if (start != null) yield [byteIndex(start), byteIndex(prev + 1)]
      break
    }
    if (prev != undefined) {
      let d = curr - prev
      if (d == 1) {
        prev = curr
      } else if (d > 1) {
        yield [byteIndex(start), byteIndex(prev + 1)]
        start = curr
      } else {
        // invalid number
        yield [byteIndex(start), byteIndex(prev + 1)]
        break
      }
    } else {
      start = curr
    }
    prev = curr
    if (i == len - 1) {
      yield [byteIndex(start), byteIndex(prev + 1)]
    }
  }
}

export class FuzzyMatch {
  private contentPtr: number | undefined
  private patternPtr: number | undefined
  private resultPtr: number | undefined
  private patternLength = 0
  private matchSeq = false
  private sizes: number[] = [2048, 1024, 1024]

  constructor(private exports: FuzzyWasi) {
  }

  /**
   * Match character positions to column spans.
   */
  public matchSpans(text: string, positions: ArrayLike<number>, max?: number): Iterable<[number, number]> {
    return matchSpans(text, positions, max)
  }

  public getSizes(): number[] {
    return this.sizes
  }

  public setPattern(pattern: string, matchSeq = false): void {
    // Can't handle length > 256
    if (pattern.length > 256) pattern = pattern.slice(0, 256)
    this.matchSeq = matchSeq
    this.patternLength = matchSeq ? pattern.length : pattern.replace(/(\s|\t)/g, '').length
    if (this.patternPtr == null) {
      let { malloc } = this.exports
      let { sizes } = this
      this.contentPtr = malloc(sizes[0])
      this.patternPtr = malloc(sizes[1])
      this.resultPtr = malloc(sizes[2])
    }
    let buf = Buffer.from(pattern, 'utf8')
    let len = buf.length
    let bytes = new Uint8Array(this.exports.memory.buffer, this.patternPtr, len + 1)
    bytes.set(buf)
    bytes[len] = 0
  }

  private changeContent(text: string): void {
    let { sizes } = this
    if (text.length > 4096) text = text.slice(0, 4096)
    let buf = Buffer.from(text, 'utf8')
    let len = buf.length
    if (len > sizes[0]) {
      let { malloc, free } = this.exports
      free(this.contentPtr)
      let byteLength = len + 1
      this.contentPtr = malloc(byteLength)
      sizes[0] = byteLength
    }
    let bytes = new Uint8Array(this.exports.memory.buffer, this.contentPtr, len + 1)
    bytes.set(buf)
    bytes[len] = 0
  }

  public match(text: string): MatchResult | undefined {
    if (this.patternPtr == null) throw new Error('setPattern not called before match')
    if (this.patternLength === 0) return { score: 100, positions: new Uint32Array() }
    this.changeContent(text)
    let { fuzzyMatch, memory } = this.exports
    let { resultPtr } = this
    let score = fuzzyMatch(this.contentPtr, this.patternPtr, resultPtr, this.matchSeq ? 1 : 0)
    if (!score) return undefined
    const u32 = new Uint32Array(memory.buffer, resultPtr, this.patternLength)
    return { score, positions: u32.slice() }
  }

  public matchHighlights(text: string, hlGroup: string): MatchHighlights | undefined {
    let res = this.match(text)
    if (!res) return undefined
    let highlights: AnsiHighlight[] = []
    for (let span of this.matchSpans(text, res.positions)) {
      highlights.push({ span, hlGroup })
    }
    return { score: res.score, highlights }
  }

  public free(): void {
    let ptrs = [this.contentPtr, this.patternPtr, this.resultPtr]
    let { free } = this.exports
    ptrs.forEach(p => {
      if (p != null) free(p)
    })
    this.contentPtr = this.patternPtr = this.resultPtr = undefined
  }
}
