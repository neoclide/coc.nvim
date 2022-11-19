import { pluginRoot } from '../util/constants'
import { fs, path, promisify } from '../util/node'

export interface StrWidthWasi {
  strWidth: (textPtr: number) => number
  setAmbw: (ambiguousAsDouble: number) => void
  malloc: (size: number) => number
  free: (ptr: number) => void
  memory: {
    buffer: ArrayBuffer
  }
}

const wasmPath = path.join(pluginRoot, 'bin/strwidth.wasm')

export async function initStrWidthWasm(): Promise<StrWidthWasi> {
  const buffer = await promisify(fs.readFile)(wasmPath)
  const res = await global.WebAssembly.instantiate(buffer, { env: {} })
  return res.instance.exports as StrWidthWasi
}
let instance: StrWidth

export class StrWidth {
  private contentPtr: number | undefined
  private bytes: Uint8Array
  private cache: Map<string, number> = new Map()
  constructor(private exports: StrWidthWasi) {
    this.bytes = new Uint8Array(exports.memory.buffer)
    this.contentPtr = exports.malloc(4096)
  }

  public setAmbw(ambiguousAsDouble: boolean): void {
    this.exports.setAmbw(ambiguousAsDouble ? 1 : 0)
    this.cache.clear()
  }

  public getWidth(content: string, cache = false): number {
    let l = content.length
    if (l === 0) return 0
    if (l > 4095) {
      content = content.slice(0, 4095)
    }
    if (cache && this.cache.has(content)) {
      return this.cache.get(content)
    }
    let { contentPtr } = this
    let buf = Buffer.from(content, 'utf8')
    let len = buf.length
    this.bytes.set(buf, contentPtr)
    this.bytes[contentPtr + len] = 0
    let res = this.exports.strWidth(contentPtr)
    if (cache) this.cache.set(content, res)
    return res
  }

  public static async create(): Promise<StrWidth> {
    if (instance) return instance
    let api = await initStrWidthWasm()
    instance = new StrWidth(api)
    return instance
  }
}
