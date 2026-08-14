'use strict'
import { fs } from '../util/node'

/**
 * Shared exports of coc's wasm modules (fuzzy match, strwidth).
 */
export interface WasiExports {
  malloc: (size: number) => number
  free: (ptr: number) => void
  memory: {
    buffer: ArrayBuffer
  }
}

export async function initWasm(filepath: string): Promise<WasiExports> {
  const buffer = await fs.promises.readFile(filepath)
  const res = await global.WebAssembly.instantiate(buffer, { env: {} })
  return res.instance.exports as WasiExports
}
