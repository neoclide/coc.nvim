import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Encoder, ExtensionCodec } from '@msgpack/msgpack'
import { PassThrough } from 'stream'
import { NvimTransport } from '../../neovim/transport/nvim'
import { Metadata } from '../../neovim/api/types'
import { nullLogger } from '../../neovim/utils/logger'

/**
 * NvimTransport reads msgpack-RPC frames from a Readable stream and emits
 * 'request' / 'notification' events; pending request callbacks are also
 * resolved when their responses arrive.
 *
 * These tests feed a PassThrough stream — playing the role of nvim's stdout —
 * with hand-encoded msgpack frames and assert the transport produces the
 * expected events. A separate PassThrough acts as the writer (nvim's stdin)
 * so we can also assert what the transport writes back when handling a
 * request.
 *
 * The key behaviors under test:
 *1. notifications surface via the 'notification' event with method+args
 *2. requests surface via the 'request' event with a working Response
 *3. pending requests get resolved when a matching response arrives
 *4. multiple frames in a single chunk are all decoded
 *5. a frame split across many tiny chunks is reassembled correctly
 *(this is the regression scenario from nvim 0.12)
 *6. invalid (non-array) frames don't terminate the decode loop
 */
describe('NvimTransport message reception', () => {
  // Build an encoder with the same extension registry the transport uses,
  // so the wire format matches exactly.
  const extCodec = new ExtensionCodec()
  Metadata.forEach(({ constructor }, id) => {
    extCodec.register({
      type: id,
      encode: (input: any) => {
        if (input instanceof constructor) return new Encoder().encode(input.data)
        return null
      },
      decode: () => null,
    })
  })
  const encoder = new Encoder({ extensionCodec: extCodec, ignoreUndefined: true })

  function encodeFrame(frame: unknown[]): Buffer {
    const u8 = encoder.encode(frame)
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
  }

  let reader: PassThrough
  let writer: PassThrough
  let transport: NvimTransport

  beforeEach(() => {
    reader = new PassThrough()
    writer = new PassThrough()
    transport = new NvimTransport(nullLogger)
    // The transport only touches `client` via the extension codec on decode,
    // and the test frames don't include any ext-typed values, so we can pass
    // a stub.
    transport.attach(writer, reader, {} as any)
  })

  it('emits notification with method name and args', async () => {
    const handler = vi.fn()
    transport.on('notification', handler)

    // [type=2, method, args] — a notification frame.
    reader.write(encodeFrame([2, 'GreetEvent', ['hello', 42]]))

    await waitFor(() => handler.mock.calls.length === 1)
    expect(handler).toHaveBeenCalledWith('GreetEvent', ['hello', 42])
  })

  it('emits multiple notifications coalesced into one chunk', async () => {
    const handler = vi.fn()
    transport.on('notification', handler)

    const a = encodeFrame([2, 'A', [1]])
    const b = encodeFrame([2, 'B', [2]])
    const c = encodeFrame([2, 'C', [3]])
    reader.write(Buffer.concat([a, b, c]))

    await waitFor(() => handler.mock.calls.length === 3)
    expect(handler.mock.calls.map(([m]) => m)).toEqual(['A', 'B', 'C'])
    expect(handler.mock.calls.map(([, args]) => args)).toEqual([[1], [2], [3]])
  })

  it('reassembles a frame that arrives split into many tiny chunks', async () => {
    // Regression: nvim 0.12 chunks pipe writes around 8KB. With the old
    // Buffered + msgpack-lite path, this caused 500+ DecodeStream calls for
    // a single buf_lines event. With @msgpack/msgpack's decodeMultiStream,
    // chunk boundaries do not affect message-level parsing.
    const big = 'x'.repeat(20000)
    const frame = encodeFrame([2, 'BufLines', [0, 1, [big, big, big]]])
    const handler = vi.fn()
    transport.on('notification', handler)

    // Write the frame in 64-byte slices so the underlying stream sees many
    // distinct 'data' events.
    for (let i = 0; i < frame.length; i += 64) {
      reader.write(frame.slice(i, Math.min(i + 64, frame.length)))
    }

    await waitFor(() => handler.mock.calls.length === 1, 2000)
    expect(handler).toHaveBeenCalledTimes(1)
    const [method, args] = handler.mock.calls[0]
    expect(method).toBe('BufLines')
    expect(args[0]).toBe(0)
    expect(args[1]).toBe(1)
    expect(args[2]).toEqual([big, big, big])
  })

  it('emits request event with a working Response handle', async () => {
    const handler = vi.fn()
    transport.on('request', handler)

    // [type=0, id, method, args]
    reader.write(encodeFrame([0, 7, 'doSomething', ['arg1']]))

    await waitFor(() => handler.mock.calls.length === 1)
    const [method, args, response] = handler.mock.calls[0]
    expect(method).toBe('doSomething')
    expect(args).toEqual(['arg1'])
    expect(typeof response.send).toBe('function')

    const written: Buffer[] = []
    writer.on('data', chunk => written.push(chunk))
    response.send({ ok: true })
    await waitFor(() => written.length > 0)
    // First and only response frame is [1, requestId, errOrNull, result].
    // We're not fully decoding here — just sanity-checking that something
    // went out on the writer.
    expect(Buffer.concat(written).length).toBeGreaterThan(0)
  })

  it('resolves a pending request when its response arrives', async () => {
    const cb = vi.fn()
    const written: Buffer[] = []
    writer.on('data', c => written.push(c))

    transport.request('nvim_eval', ['1+1'], cb)
    await waitFor(() => written.length > 0)

    // Decode the outbound request frame to extract the id the transport
    // chose, then craft a matching response.
    const { decode } = await import('@msgpack/msgpack')
    const out = decode(Buffer.concat(written)) as any[]
    expect(out[0]).toBe(0)         // type=request
    expect(out[2]).toBe('nvim_eval')
    const id = out[1] as number

    // [type=1, id, errOrNull, result]
    reader.write(encodeFrame([1, id, null, 2]))

    await waitFor(() => cb.mock.calls.length === 1)
    expect(cb).toHaveBeenCalledWith(null, 2)
  })

  it('skips a non-array frame without halting the stream', async () => {
    const handler = vi.fn()
    transport.on('notification', handler)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Encode a bare integer (invalid msgpack-RPC frame) followed by a valid
    // notification. The transport should log the error and keep going.
    const bad = encoder.encode(123)
    const good = encodeFrame([2, 'After', []])
    reader.write(Buffer.concat([
      Buffer.from(bad.buffer, bad.byteOffset, bad.byteLength),
      good,
    ]))

    await waitFor(() => handler.mock.calls.length === 1, 1000)
    expect(handler).toHaveBeenCalledWith('After', [])
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

/** Simple polling helper so tests don't rely on timer mocks. */
async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}
