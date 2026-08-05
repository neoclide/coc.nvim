'use strict'
import { DEFAULT_FRAME_MAX_BYTES } from './protocol'

/**
 * NDJSON framing shared by the socket transport and the stdio bridge.
 * One JSON-RPC message per line, UTF-8, no embedded newlines (same framing
 * as MCP stdio transport).
 */

export interface FrameError {
  message: string
  raw?: string
}

export class FrameSplitter {
  private buffer: Buffer = Buffer.alloc(0)
  private disposed = false

  constructor(
    private maxBytes: number = DEFAULT_FRAME_MAX_BYTES,
    private onFrame: (msg: any) => void,
    private onError: (err: FrameError) => void
  ) {
  }

  public push(chunk: Buffer | string): void {
    if (this.disposed) return
    let buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    if (buf.length === 0) return
    this.buffer = this.buffer.length === 0 ? buf : Buffer.concat([this.buffer, buf])
    let index: number
    while ((index = this.buffer.indexOf(10)) !== -1) {
      let line = this.buffer.subarray(0, index)
      this.buffer = this.buffer.subarray(index + 1)
      if (line.length === 0) continue
      // The limit counts UTF-8 bytes, not UTF-16 code units.
      if (line.length > this.maxBytes) {
        this.onError({ message: `Frame exceeds ${this.maxBytes} bytes` })
        continue
      }
      this.processLine(line)
    }
    // Guard against unbounded buffering when no complete frame arrives.
    if (this.buffer.length > this.maxBytes) {
      this.onError({ message: `Frame exceeds ${this.maxBytes} bytes` })
      this.buffer = Buffer.alloc(0)
    }
  }

  private processLine(line: Buffer): void {
    let text = line.toString('utf8')
    let msg: any
    try {
      msg = JSON.parse(text)
    } catch (e) {
      this.onError({ message: e instanceof Error ? e.message : String(e), raw: text })
      return
    }
    this.onFrame(msg)
  }

  public dispose(): void {
    this.disposed = true
    this.buffer = Buffer.alloc(0)
  }
}

export function encodeMessage(msg: any): Buffer {
  let line = JSON.stringify(msg)
  if (line == null) {
    throw new Error('Unable to serialize message to JSON')
  }
  return Buffer.from(line + '\n', 'utf8')
}
