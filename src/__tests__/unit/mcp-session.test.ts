'use strict'
import type { Socket } from 'net'
import { Session } from '../../mcp/session'

function createSocket(t: any, overrides: Record<string, unknown> = {}): Socket {
  return {
    write: t.mock.fn(),
    end: t.mock.fn(),
    ...overrides
  } as unknown as Socket
}

describe('mcp Session', () => {
  it('closes an unauthenticated session after the auth timeout', t => {
    t.mock.timers.enable()
    let socket = createSocket(t)
    let onClose = t.mock.fn()
    let session = new Session(socket, onClose, 10)
    t.mock.timers.tick(10)
    assert.strictEqual(session.active, false)
    assert.deepStrictEqual(onClose.mock.calls[0].arguments, [session])
    assert.ok((socket.end as any).mock.callCount() > 0)
  })

  it('keeps an authenticated session open after the auth timeout', t => {
    t.mock.timers.enable()
    let socket = createSocket(t)
    let session = new Session(socket, t.mock.fn(), 10)
    session.authenticated = true
    t.mock.timers.tick(10)
    assert.strictEqual(session.active, true)
    session.close()
  })

  it('closes the session when writing to the socket throws', t => {
    let socket = createSocket(t, {
      write: t.mock.fn(() => {
        throw new Error('write failed')
      })
    })
    let onClose = t.mock.fn()
    let session = new Session(socket, onClose, 0)
    session.sendResult(1, { ok: true })
    assert.strictEqual(session.active, false)
    assert.deepStrictEqual(onClose.mock.calls[0].arguments, [session])
  })

  it('sends errors and notifications with optional data', t => {
    let socket = createSocket(t)
    let session = new Session(socket, t.mock.fn(), 0)
    session.sendError(1, -1, 'failed', { detail: true })
    session.sendNotification('coc/test', { value: 1 })
    session.sendNotification('coc/empty')
    let writes = (socket.write as any).mock.calls.map(call => (call.arguments[0] as Buffer).toString())
    assert.ok(writes[0].includes('"data":{"detail":true}'))
    assert.ok(writes[1].includes('"params":{"value":1}'))
    assert.ok(!writes[2].includes('params'))
    session.close()
  })

  it('uses a sliding request limit and allows unlimited requests', t => {
    t.mock.timers.enable()
    t.mock.timers.setTime(1000)
    let session = new Session(createSocket(t), t.mock.fn(), 0)
    assert.strictEqual(session.checkRateLimit(0), true)
    assert.strictEqual(session.checkRateLimit(1), true)
    assert.strictEqual(session.checkRateLimit(1), false)
    t.mock.timers.setTime(2001)
    assert.strictEqual(session.checkRateLimit(1), true)
    session.close()
  })

  it('refreshes and fires the idle timeout', t => {
    t.mock.timers.enable()
    let onClose = t.mock.fn()
    let session = new Session(createSocket(t), onClose, 0, 20)
    session.touch()
    t.mock.timers.tick(10)
    session.touch()
    t.mock.timers.tick(19)
    assert.strictEqual(session.active, true)
    t.mock.timers.tick(1)
    assert.strictEqual(session.active, false)
  })

  it('cancels pending work and ignores sends after close', t => {
    let socket = createSocket(t, { end: t.mock.fn(() => { throw new Error('end failed') }) })
    let cancel = t.mock.fn()
    let session = new Session(socket, t.mock.fn(), 0)
    session.pending.set(1, { cancel })
    session.close()
    session.close()
    session.sendResult(1, {})
    assert.strictEqual(cancel.mock.callCount(), 1)
    assert.strictEqual((socket.write as any).mock.callCount(), 0)
  })

  it('drops queued tasks after close and keeps the queue alive after rejection', async t => {
    let session = new Session(createSocket(t), t.mock.fn(), 0)
    let calls: string[] = []
    let done!: () => void
    let completed = new Promise<void>(resolve => { done = resolve })
    session.enqueue(async () => { calls.push('first'); throw new Error('failed') })
    session.enqueue(async () => { calls.push('second'); done() })
    await completed
    assert.deepStrictEqual(calls, ['first', 'second'])
    session.enqueue(async () => { calls.push('closed') })
    session.close()
    await Promise.resolve()
    assert.ok(!calls.includes('closed'))
  })
})
