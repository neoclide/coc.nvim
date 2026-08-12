'use strict'
import { encodeMessage, FrameSplitter } from '../../mcp/framing'

describe('mcp framing', () => {
  it('should encode a message as a single newline-delimited line', () => {
    let buf = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })
    assert.strictEqual(buf.toString('utf8'), '{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
  })

  it('rejects values that JSON cannot serialize', () => {
    assert.throws(() => encodeMessage(undefined), error => String(error instanceof Error ? error.message : error).includes('Unable to serialize message to JSON'))
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
    assert.deepStrictEqual(errors, [])
    assert.deepStrictEqual(frames, [{ jsonrpc: '2.0', id: 1, method: 'ping' }])
  })

  it('should handle multiple frames in one chunk and skip empty lines', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n'))
    assert.deepStrictEqual(errors, [])
    assert.strictEqual(frames.length, 2)
    assert.strictEqual(frames[0].id, 1)
    assert.strictEqual(frames[1].id, 2)
  })

  it('accepts string chunks and ignores empty or disposed input', () => {
    let frames: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), () => {})
    splitter.push('')
    splitter.push('{"id":1}\n')
    splitter.dispose()
    splitter.push('{"id":2}\n')
    assert.deepStrictEqual(frames, [{ id: 1 }])
  })

  it('should report JSON parse errors with the raw line', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(1024, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('{"jsonrpc":"2.0","id":3,"method":"ping"\n'))
    assert.deepStrictEqual(frames, [])
    assert.strictEqual(errors.length, 1)
    assert.ok((errors[0].raw).includes('"id":3'))
  })

  it('should report oversized frames', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(16, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from(JSON.stringify({ value: 'x'.repeat(100) }) + '\n'))
    assert.deepStrictEqual(frames, [])
    assert.strictEqual(errors.length, 1)
    assert.ok((errors[0].message).includes('exceeds'))
  })

  it('should drop buffered data when no newline arrives beyond the limit', () => {
    let frames: any[] = []
    let errors: any[] = []
    let splitter = new FrameSplitter(16, msg => frames.push(msg), err => errors.push(err))
    splitter.push(Buffer.from('x'.repeat(20)))
    assert.strictEqual(errors.length, 1)
    assert.deepStrictEqual(frames, [])
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
      assert.deepStrictEqual(errors, [], `split at ${split}`)
      assert.deepStrictEqual(frames, [msg], `split at ${split}`)
    }
  })

  it('counts frame size in bytes, not characters', () => {
    let frames: any[] = []
    let errors: any[] = []
    // 8 multibyte chars: 8 code units but 24 bytes, above the 16-byte limit
    let splitter = new FrameSplitter(16, m => frames.push(m), err => errors.push(err))
    splitter.push(encodeMessage({ value: '你'.repeat(8) }))
    assert.deepStrictEqual(frames, [])
    assert.strictEqual(errors.length, 1)
    assert.ok((errors[0].message).includes('exceeds'))
  })
})
