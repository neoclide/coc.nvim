'use strict'
import { describe, expect, it } from 'vitest'
import { encodeMessage, FrameSplitter } from '../../mcp/framing'

describe('mcp framing', () => {
  it('should encode a message as a single newline-delimited line', () => {
    let buf = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(buf.toString('utf8')).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
  })

  it('rejects values that JSON cannot serialize', () => {
    expect(() => encodeMessage(undefined)).toThrow('Unable to serialize message to JSON')
  })

  it('should split frames arriving in separate chunks', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), err => errors.push(err))
    let line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    let buf = Buffer.from(line + '\n', 'utf8')
    for (let i = 0; i < buf.length; i++) {
      splitter.push(buf.subarray(i, i + 1))
    }
    expect(errors).toEqual([])
    expect(frames).toEqual([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
  })

  it('should handle multiple frames in one chunk and skip empty lines', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n'))
    expect(errors).toEqual([])
    expect(frames.length).toBe(2)
    expect(frames[0].id).toBe(1)
    expect(frames[1].id).toBe(2)
  })

  it('accepts string chunks and ignores empty or disposed input', () => {
    let frames: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), () => {})
    splitter.push('')
    splitter.push('{"id":1}\n')
    splitter.dispose()
    splitter.push('{"id":2}\n')
    expect(frames).toEqual([{ id: 1 }])
  })

  it('should report JSON parse errors with the raw line', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('{"jsonrpc":"2.0","id":3,"method":"ping"\n'))
    expect(frames).toEqual([])
    expect(errors.length).toBe(1)
    expect(errors[0].raw).toContain('"id":3')
  })

  it('should report oversized frames', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(16, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from(JSON.stringify({ value: 'x'.repeat(100) }) + '\n'))
    expect(frames).toEqual([])
    expect(errors.length).toBe(1)
    expect(errors[0].message).toContain('exceeds')
  })

  it('should drop buffered data when no newline arrives beyond the limit', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(16, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('x'.repeat(20)))
    expect(errors.length).toBe(1)
    expect(frames).toEqual([])
  })

  it('preserves multibyte characters split at every byte boundary', () => {
    let msg = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { text: '你好，世界 😀' } }
    let buf = encodeMessage(msg)
    for (let split = 0; split < buf.length; split++) {
      let frames: any[] = []
      let errors: any[] = []
      let splitter = new FrameSplitter(1024, m => frames.push(m), err => errors.push(err))
      splitter.push(buf.subarray(0, split))
      splitter.push(buf.subarray(split))
      expect(errors, `split at ${split}`).toEqual([])
      expect(frames, `split at ${split}`).toEqual([msg])
    }
  })

  it('counts frame size in bytes, not characters', () => {
    let frames: any[] = []
    let errors: any[] = []
    // 8 multibyte chars: 8 code units but 24 bytes, above the 16-byte limit
    let splitter = new FrameSplitter(16, m => frames.push(m), err => errors.push(err))
    splitter.push(encodeMessage({ value: '你'.repeat(8) }))
    expect(frames).toEqual([])
    expect(errors.length).toBe(1)
    expect(errors[0].message).toContain('exceeds')
  })
})
