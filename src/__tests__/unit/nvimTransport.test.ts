import { isDeepStrictEqual } from 'node:util'
import { Encoder, ExtensionCodec } from '@msgpack/msgpack'
import { PassThrough } from 'stream'
import { Buffer as NvimBuffer, Tabpage, Window as NvimWindow } from '@chemzqm/neovim'
import Request from '@chemzqm/neovim/lib/transport/request'
import { NvimTransport } from '@chemzqm/neovim/lib/transport/nvim'
import { Metadata } from '@chemzqm/neovim/lib/api/types'
import { nullLogger } from '@chemzqm/neovim/lib/utils/logger'
import helper from '../helper'

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
 * 1. notifications surface via the 'notification' event with method+args
 * 2. requests surface via the 'request' event with a working Response
 * 3. pending requests get resolved when a matching response arrives
 * 4. multiple frames in a single chunk are all decoded
 * 5. a frame split across many tiny chunks is reassembled correctly for the nvim 0.12 regression
 * 6. invalid (non-array) frames don't terminate the decode loop
 * 7. Neovim msgpack extension handles round-trip correctly
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
  let client: object

  beforeEach(() => {
    reader = new PassThrough()
    writer = new PassThrough()
    transport = new NvimTransport(nullLogger)
    client = { name: 'client' }
    transport.attach(writer, reader, client as any)
  })

  afterEach(() => {
    transport.detach()
  })

  it('emits notification with method name and args', async (t) => {
    const handler = t.mock.fn()
    transport.on('notification', handler)

    // [type=2, method, args] — a notification frame.
    reader.write(encodeFrame([2, 'GreetEvent', ['hello', 42]]))

    await helper.waitValue(() => handler.mock.calls.length, 1)
    assert.ok((handler).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['GreetEvent', ['hello', 42]])))
  })

  it('emits multiple notifications coalesced into one chunk', async (t) => {
    const handler = t.mock.fn()
    transport.on('notification', handler)

    const a = encodeFrame([2, 'A', [1]])
    const b = encodeFrame([2, 'B', [2]])
    const c = encodeFrame([2, 'C', [3]])
    reader.write(Buffer.concat([a, b, c]))

    await helper.waitValue(() => handler.mock.calls.length, 3)
    assert.deepStrictEqual(handler.mock.calls.map(call => call.arguments[0]), ['A', 'B', 'C'])
    assert.deepStrictEqual(handler.mock.calls.map(call => call.arguments[1]), [[1], [2], [3]])
  })

  it('reassembles a frame that arrives split into many tiny chunks', async (t) => {
    // Regression: nvim 0.12 chunks pipe writes around 8KB. With the old
    // Buffered + msgpack-lite path, this caused 500+ DecodeStream calls for
    // a single buf_lines event. With @msgpack/msgpack's decodeMultiStream,
    // chunk boundaries do not affect message-level parsing.
    const big = 'x'.repeat(20000)
    const frame = encodeFrame([2, 'BufLines', [0, 1, [big, big, big]]])
    const handler = t.mock.fn()
    transport.on('notification', handler)

    // Write the frame in 64-byte slices so the underlying stream sees many
    // distinct 'data' events.
    for (let i = 0; i < frame.length; i += 64) {
      reader.write(frame.slice(i, Math.min(i + 64, frame.length)))
    }

    await helper.waitValue(() => handler.mock.calls.length, 1)
    assert.strictEqual((handler).mock.callCount(), 1)
    const [method, args] = handler.mock.calls[0].arguments
    assert.strictEqual(method, 'BufLines')
    assert.strictEqual(args[0], 0)
    assert.strictEqual(args[1], 1)
    assert.deepStrictEqual(args[2], [big, big, big])
  })

  it('emits request event with a working Response handle', async (t) => {
    const handler = t.mock.fn()
    transport.on('request', handler)

    // [type=0, id, method, args]
    reader.write(encodeFrame([0, 7, 'doSomething', ['arg1']]))

    await helper.waitValue(() => handler.mock.calls.length, 1)
    const [method, args, response] = handler.mock.calls[0].arguments
    assert.strictEqual(method, 'doSomething')
    assert.deepStrictEqual(args, ['arg1'])
    assert.strictEqual(typeof response.send, 'function')

    const written: Buffer[] = []
    writer.on('data', chunk => written.push(chunk))
    response.send({ ok: true })
    await helper.waitValue(() => written.length > 0, true)
    // First and only response frame is [1, requestId, errOrNull, result].
    // We're not fully decoding here — just sanity-checking that something
    // went out on the writer.
    assert.ok((Buffer.concat(written).length) > (0))
  })

  it('resolves a pending request when its response arrives', async (t) => {
    const cb = t.mock.fn()
    const written: Buffer[] = []
    writer.on('data', c => written.push(c))

    transport.request('nvim_eval', ['1+1'], cb)
    await helper.waitValue(() => written.length > 0, true)

    // Decode the outbound request frame to extract the id the transport
    // chose, then craft a matching response.
    const { decode } = await import('@msgpack/msgpack')
    const out = decode(Buffer.concat(written)) as any[]
    assert.strictEqual(out[0], 0)         // type=request
    assert.strictEqual(out[2], 'nvim_eval')
    const id = out[1] as number

    // [type=1, id, errOrNull, result]
    reader.write(encodeFrame([1, id, null, 2]))

    await helper.waitValue(() => cb.mock.calls.length, 1)
    assert.ok((cb).mock.calls.some(call => isDeepStrictEqual(call.arguments, [null, 2])))
  })

  it('skips a non-array frame without halting the stream', async (t) => {
    const handler = t.mock.fn()
    transport.on('notification', handler)
    const errSpy = t.mock.method(console, 'error', () => {})

    // Encode a bare integer (invalid msgpack-RPC frame) followed by a valid
    // notification. The transport should log the error and keep going.
    const bad = encoder.encode(123)
    const good = encodeFrame([2, 'After', []])
    reader.write(Buffer.concat([
      Buffer.from(bad.buffer, bad.byteOffset, bad.byteLength),
      good,
    ]))

    await helper.waitValue(() => handler.mock.calls.length, 1)
    assert.ok((handler).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['After', []])))
    assert.ok((errSpy).mock.callCount() > 0)
    errSpy.mock.restore()
  })

  it('decodes msgpack extension handles with the attached client', async (t) => {
    const handler = t.mock.fn()
    transport.on('notification', handler)

    reader.write(encodeFrame([
      2,
      'HandleEvent',
      [
        new NvimBuffer({ data: 3 }),
        new NvimWindow({ data: 4 }),
        new Tabpage({ data: 5 }),
      ],
    ]))

    await helper.waitValue(() => handler.mock.calls.length, 1)
    const [buf, win, tab] = handler.mock.calls[0].arguments[1]
    assert.ok((buf) instanceof (NvimBuffer))
    assert.ok((win) instanceof (NvimWindow))
    assert.ok((tab) instanceof (Tabpage))
    assert.strictEqual(buf.id, 3)
    assert.strictEqual(win.id, 4)
    assert.strictEqual(tab.id, 5)
    assert.strictEqual((buf as any).client, client)
    assert.strictEqual((win as any).client, client)
    assert.strictEqual((tab as any).client, client)
  })

  it('encodes API handles as msgpack extension values', async (t) => {
    const written: Buffer[] = []
    writer.on('data', c => written.push(c))

    transport.request('nvim_win_set_buf', [
      new NvimWindow({ data: 4 }),
      new NvimBuffer({ data: 3 }),
      new Tabpage({ data: 5 }),
    ], t.mock.fn())

    await helper.waitValue(() => written.length > 0, true)
    const { decode, ExtData } = await import('@msgpack/msgpack')
    const out = decode(Buffer.concat(written)) as any[]
    const [win, buf, tab] = out[3]
    assert.ok((win) instanceof (ExtData))
    assert.ok((buf) instanceof (ExtData))
    assert.ok((tab) instanceof (ExtData))
    assert.strictEqual(win.type, 1)
    assert.strictEqual(buf.type, 0)
    assert.strictEqual(tab.type, 2)
    let winData = win.data
    let bufData = buf.data
    let tabData = tab.data
    assert.ok(winData instanceof Uint8Array)
    assert.ok(bufData instanceof Uint8Array)
    assert.ok(tabData instanceof Uint8Array)
    assert.strictEqual(decode(winData), 4)
    assert.strictEqual(decode(bufData), 3)
    assert.strictEqual(decode(tabData), 5)
  })

  it('does not emit messages after detach', async (t) => {
    const handler = t.mock.fn()
    transport.on('notification', handler)

    transport.detach()
    reader.write(encodeFrame([2, 'AfterDetach', []]))

    await helper.wait(25)
    assert.strictEqual((handler).mock.callCount(), 0)
  })
})

describe('Request callback', () => {
  it('should handle empty result for list requests', (t) => {
    let cb = t.mock.fn()
    let r = new Request({ call: () => {} } as any, cb, 1)
    r.request('nvim_list_wins')
    r.callback({ createWindow: (o: any) => o } as any, null, undefined)
    assert.ok((cb).mock.calls.some(call => isDeepStrictEqual(call.arguments, [null, []])))
  })
})
