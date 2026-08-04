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
  private buffer = ''
  private disposed = false

  constructor(
    private maxBytes: number = DEFAULT_FRAME_MAX_BYTES,
    private onFrame: (msg: any) => void,
    private onError: (err: FrameError) => void
  ) {
  }

  public push(chunk: Buffer | string): void {
    if (this.disposed) return
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    // Guard against unbounded buffering when no newline arrives.
    if (this.buffer.length > this.maxBytes && this.buffer.indexOf('\n') === -1) {
      this.onError({ message: `Frame exceeds ${this.maxBytes} bytes` })
      this.buffer = ''
      return
    }
    let index: number
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (line.length === 0) continue
      if (line.length > this.maxBytes) {
        this.onError({ message: `Frame exceeds ${this.maxBytes} bytes` })
        continue
      }
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch (e) {
        this.onError({ message: e instanceof Error ? e.message : String(e), raw: line })
        continue
      }
      this.onFrame(msg)
    }
  }

  public dispose(): void {
    this.disposed = true
    this.buffer = ''
  }
}

export function encodeMessage(msg: any): Buffer {
  let line = JSON.stringify(msg)
  if (line == null) {
    throw new Error('Unable to serialize message to JSON')
  }
  return Buffer.from(line + '\n', 'utf8')
}
