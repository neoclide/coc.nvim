import { isDeepStrictEqual } from 'node:util'
import type { Mock as NodeMock } from 'node:test'
import { EXIT_TIMEOUT, gracefulExit, registerExitHandlers, setExitHook } from '../../exit'
import mcp from '../../mcp'
import services from '../../services'
import helper from '../helper'

describe('gracefulExit()', () => {
  let exitCode: number | undefined
  let stopSpy: NodeMock<any> | undefined

  beforeEach(() => {
    exitCode = undefined
    setExitHook(code => {
      exitCode = code
      return undefined as never
    })
  })

  afterEach(() => {
    setExitHook(code => process.exit(code))
    if (stopSpy) stopSpy.mock.restore()
    stopSpy = undefined
  })

  it('should stop services before exit', async (t) => {
    stopSpy = t.mock.method(services, 'stopAll', () => Promise.resolve(undefined))
    let mcpSpy = t.mock.method(mcp, 'stop')
    try {
      gracefulExit('SIGTERM')
      await helper.waitValue(() => exitCode, 0)
      assert.ok((stopSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, [EXIT_TIMEOUT])))
      assert.strictEqual((mcpSpy).mock.callCount(), 1)
    } finally {
      mcpSpy.mock.restore()
    }
  })

  it('should exit on timeout when stop hangs', async (t) => {
    stopSpy = t.mock.method(services, 'stopAll', () => new Promise(() => {}))
    let mcpSpy = t.mock.method(mcp, 'stop')
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      gracefulExit('SIGTERM')
      t.mock.timers.tick(EXIT_TIMEOUT)
      await Promise.resolve()
      assert.strictEqual(exitCode, 0)
    } finally {
      t.mock.timers.reset()
      mcpSpy.mock.restore()
    }
  })

  it('should register signal handlers and ignore repeated signals', async (t) => {
    let handlers = new Map<string, (...args: any[]) => void>()
    let onSpy = t.mock.method(process, 'on', ((event: string, listener: (...args: any[]) => void) => {
      handlers.set(event, listener)
      return process
    }) as any)
    let mcpSpy = t.mock.method(mcp, 'stop')
    stopSpy = t.mock.method(services, 'stopAll', () => Promise.resolve(undefined))
    try {
      registerExitHandlers()
      assert.strictEqual(handlers.has('SIGTERM'), true)
      assert.strictEqual(handlers.has('SIGINT'), true)
      handlers.get('SIGTERM')!()
      handlers.get('SIGINT')!()
      await helper.waitValue(() => exitCode, 0)
      assert.strictEqual((mcpSpy).mock.callCount(), 1)
      assert.strictEqual((stopSpy).mock.callCount(), 1)
    } finally {
      onSpy.mock.restore()
      mcpSpy.mock.restore()
    }
  })
})
