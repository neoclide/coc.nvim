import { EXIT_TIMEOUT, gracefulExit, registerExitHandlers, setExitHook } from '../../exit'
import mcp from '../../mcp'
import services from '../../services'
import { waitValue } from './testUtils'

describe('gracefulExit()', () => {
  let exitCode: number | undefined

  beforeEach(() => {
    exitCode = undefined
    setExitHook(code => {
      exitCode = code
      return undefined as never
    })
  })

  afterEach(() => {
    setExitHook(code => process.exit(code))
  })

  it('should stop services before exit', async t => {
    let stopSpy = t.mock.method(services, 'stopAll', async () => undefined)
    let mcpSpy = t.mock.method(mcp, 'stop')
    gracefulExit('SIGTERM')
    await waitValue<number | undefined>(() => exitCode, 0)
    assert.deepStrictEqual(stopSpy.mock.calls[0].arguments, [EXIT_TIMEOUT])
    assert.strictEqual(mcpSpy.mock.callCount(), 1)
  })

  it('should exit on timeout when stop hangs', async t => {
    t.mock.method(services, 'stopAll', () => new Promise(() => {}))
    t.mock.method(mcp, 'stop')
    t.mock.timers.enable()
    gracefulExit('SIGTERM')
    t.mock.timers.tick(EXIT_TIMEOUT)
    assert.strictEqual(exitCode, 0)
  })

  it('should register signal handlers and ignore repeated signals', async t => {
    let handlers = new Map<string, (...args: any[]) => void>()
    t.mock.method(process, 'on', ((event: string, listener: (...args: any[]) => void) => {
      handlers.set(event, listener)
      return process
    }) as any)
    let mcpSpy = t.mock.method(mcp, 'stop')
    let stopSpy = t.mock.method(services, 'stopAll', async () => undefined)
    registerExitHandlers()
    assert.strictEqual(handlers.has('SIGTERM'), true)
    assert.strictEqual(handlers.has('SIGINT'), true)
    handlers.get('SIGTERM')!()
    handlers.get('SIGINT')!()
    await waitValue<number | undefined>(() => exitCode, 0)
    assert.strictEqual(mcpSpy.mock.callCount(), 1)
    assert.strictEqual(stopSpy.mock.callCount(), 1)
  })
})
