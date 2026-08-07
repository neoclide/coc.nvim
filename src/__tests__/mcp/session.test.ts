'use strict'
import type { Socket } from 'net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Session } from '../../mcp/session'

function createSocket(overrides: Record<string, unknown> = {}): Socket {
  return {
    write: vi.fn(),
    end: vi.fn(),
    ...overrides
  } as unknown as Socket
}

describe('mcp Session', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes an unauthenticated session after the auth timeout', () => {
    vi.useFakeTimers()
    let socket = createSocket()
    let onClose = vi.fn()
    let session = new Session(socket, onClose, 10)
    vi.advanceTimersByTime(10)
    expect(session.active).toBe(false)
    expect(onClose).toHaveBeenCalledWith(session)
    expect(socket.end).toHaveBeenCalled()
  })

  it('keeps an authenticated session open after the auth timeout', () => {
    vi.useFakeTimers()
    let socket = createSocket()
    let session = new Session(socket, vi.fn(), 10)
    session.authenticated = true
    vi.advanceTimersByTime(10)
    expect(session.active).toBe(true)
    session.close()
  })

  it('closes the session when writing to the socket throws', () => {
    let socket = createSocket({
      write: vi.fn(() => {
        throw new Error('write failed')
      })
    })
    let onClose = vi.fn()
    let session = new Session(socket, onClose, 0)
    session.sendResult(1, { ok: true })
    expect(session.active).toBe(false)
    expect(onClose).toHaveBeenCalledWith(session)
  })

  it('sends errors and notifications with optional data', () => {
    let socket = createSocket()
    let session = new Session(socket, vi.fn(), 0)
    session.sendError(1, -1, 'failed', { detail: true })
    session.sendNotification('coc/test', { value: 1 })
    session.sendNotification('coc/empty')
    let writes = (socket.write as ReturnType<typeof vi.fn>).mock.calls.map(args => (args[0] as Buffer).toString())
    expect(writes[0]).toContain('"data":{"detail":true}')
    expect(writes[1]).toContain('"params":{"value":1}')
    expect(writes[2]).not.toContain('params')
    session.close()
  })

  it('uses a sliding request limit and allows unlimited requests', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let session = new Session(createSocket(), vi.fn(), 0)
    expect(session.checkRateLimit(0)).toBe(true)
    expect(session.checkRateLimit(1)).toBe(true)
    expect(session.checkRateLimit(1)).toBe(false)
    vi.setSystemTime(2001)
    expect(session.checkRateLimit(1)).toBe(true)
    session.close()
  })

  it('refreshes and fires the idle timeout', () => {
    vi.useFakeTimers()
    let onClose = vi.fn()
    let session = new Session(createSocket(), onClose, 0, 20)
    session.touch()
    vi.advanceTimersByTime(10)
    session.touch()
    vi.advanceTimersByTime(19)
    expect(session.active).toBe(true)
    vi.advanceTimersByTime(1)
    expect(session.active).toBe(false)
  })

  it('cancels pending work and ignores sends after close', () => {
    let socket = createSocket({ end: vi.fn(() => { throw new Error('end failed') }) })
    let cancel = vi.fn()
    let session = new Session(socket, vi.fn(), 0)
    session.pending.set(1, { cancel })
    session.close()
    session.close()
    session.sendResult(1, {})
    expect(cancel).toHaveBeenCalledOnce()
    expect(socket.write).not.toHaveBeenCalled()
  })

  it('drops queued tasks after close and keeps the queue alive after rejection', async () => {
    let session = new Session(createSocket(), vi.fn(), 0)
    let calls: string[] = []
    let done!: () => void
    let completed = new Promise<void>(resolve => { done = resolve })
    session.enqueue(async () => { calls.push('first'); throw new Error('failed') })
    session.enqueue(async () => { calls.push('second'); done() })
    await completed
    expect(calls).toEqual(['first', 'second'])
    session.enqueue(async () => { calls.push('closed') })
    session.close()
    await Promise.resolve()
    expect(calls).not.toContain('closed')
  })
})
