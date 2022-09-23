import fs from 'fs'
import path from 'path'

export interface WasiExports {
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

const filePath = path.resolve(__dirname, global.__TEST__ ? '../..' : '..', 'bin/fuzzy.wasm')

export async function initWasi(): Promise<WasiExports> {
  const buf = fs.readFileSync(filePath)
  let keys = ['environ_get', 'environ_sizes_get', 'proc_exit']
  let obj = {}
  keys.forEach(k => {
    obj[k] = () => 0
  })
  const res = await global.WebAssembly.instantiate(buf, {
    wasi_snapshot_preview1: obj,
    env: {}
  })
  return res.instance.exports as WasiExports
}

export class FuzzyMatch {
  private exports: WasiExports
  private contentPtr: number
  private patternPtr: number
  private resultPtr: number
  private patternLength: number
  private matchSeq = false
  private sizes: number[] = [2048, 1024, 1024]

  public async load(): Promise<void> {
    if (this.exports) return
    this.exports = await initWasi()
    let { malloc } = this.exports
    let { sizes } = this
    this.contentPtr = malloc(sizes[0])
    this.patternPtr = malloc(sizes[1])
    this.resultPtr = malloc(sizes[2])
  }

  public getSizes(): number[] {
    return this.sizes
  }

  public setPattern(pattern: string, matchSeq = false): void {
    if (!this.exports) throw new Error('wasm not initialized')
    // can't handle length > 256
    if (pattern.length > 256) pattern = pattern.slice(0, 256)
    this.matchSeq = matchSeq
    this.patternLength = matchSeq ? pattern.length : pattern.replace(/(\s|\t)/g, '').length
    let { memory } = this.exports
    let buf = Buffer.from(pattern, 'utf8')
    let len = buf.length
    let bytes = new Uint8Array(memory.buffer, this.patternPtr, len + 1)
    bytes.set(buf)
    bytes[len] = 0
  }

  private changeContent(text: string): void {
    let { sizes } = this
    let { memory, malloc, free } = this.exports
    let buf = Buffer.from(text, 'utf8')
    let len = buf.length
    if (len > sizes[0]) {
      free(this.contentPtr)
      let byteLength = len + 1
      this.contentPtr = malloc(byteLength)
      sizes[0] = byteLength
    }
    let contentBytes = new Uint8Array(memory.buffer, this.contentPtr, len + 1)
    contentBytes.set(buf)
    contentBytes[len] = 0
  }

  public match(text: string): MatchResult | undefined {
    if (this.patternLength == null) throw new Error('setPattern not called before match')
    this.changeContent(text)
    let { fuzzyMatch, memory } = this.exports
    let { resultPtr } = this
    let score = fuzzyMatch(this.contentPtr, this.patternPtr, resultPtr, this.matchSeq ? 1 : 0)
    if (!score) return undefined
    const u32 = new Uint32Array(memory.buffer, resultPtr, this.patternLength)
    return { score, positions: u32.slice() }
  }

  /**
   * Not used any more
   */
  public dispose(): void {
    if (!this.exports) return
    let ptrs = [this.contentPtr, this.patternPtr, this.resultPtr]
    let { free } = this.exports
    ptrs.forEach(p => {
      if (p !== null) free(p)
    })
    this.contentPtr = this.patternPtr = this.resultPtr = undefined
    this.exports = null
  }
}
