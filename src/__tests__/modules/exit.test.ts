import { EXIT_TIMEOUT, gracefulExit, registerExitHandlers, setExitHook } from '../../exit'
import mcp from '../../mcp'
import services from '../../services'

describe('gracefulExit()', () => {
  let exitCode: number | undefined
  let stopSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    exitCode = undefined
    setExitHook(code => {
      exitCode = code
      return undefined as never
    })
  })

  afterEach(() => {
    setExitHook(code => process.exit(code))
    if (stopSpy) stopSpy.mockRestore()
    stopSpy = undefined
  })

  it('should stop services before exit', async () => {
    stopSpy = vi.spyOn(services, 'stopAll').mockResolvedValue(undefined)
    let mcpSpy = vi.spyOn(mcp, 'stop')
    try {
      gracefulExit('SIGTERM')
      await vi.waitFor(() => {
        expect(exitCode).toBe(0)
      })
      expect(stopSpy).toHaveBeenCalledWith(EXIT_TIMEOUT)
      expect(mcpSpy).toHaveBeenCalledTimes(1)
    } finally {
      mcpSpy.mockRestore()
    }
  })

  it('should exit on timeout when stop hangs', async () => {
    stopSpy = vi.spyOn(services, 'stopAll').mockImplementation(() => new Promise(() => {}))
    let mcpSpy = vi.spyOn(mcp, 'stop')
    vi.useFakeTimers()
    try {
      gracefulExit('SIGTERM')
      await vi.advanceTimersByTimeAsync(EXIT_TIMEOUT)
      expect(exitCode).toBe(0)
    } finally {
      vi.useRealTimers()
      mcpSpy.mockRestore()
    }
  })

  it('should register signal handlers and ignore repeated signals', async () => {
    let handlers = new Map<string, (...args: any[]) => void>()
    let onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (...args: any[]) => void) => {
      handlers.set(event, listener)
      return process
    }) as any)
    let mcpSpy = vi.spyOn(mcp, 'stop')
    stopSpy = vi.spyOn(services, 'stopAll').mockResolvedValue(undefined)
    try {
      registerExitHandlers()
      expect(handlers.has('SIGTERM')).toBe(true)
      expect(handlers.has('SIGINT')).toBe(true)
      handlers.get('SIGTERM')!()
      handlers.get('SIGINT')!()
      await vi.waitFor(() => {
        expect(exitCode).toBe(0)
      })
      expect(mcpSpy).toHaveBeenCalledTimes(1)
      expect(stopSpy).toHaveBeenCalledTimes(1)
    } finally {
      onSpy.mockRestore()
      mcpSpy.mockRestore()
    }
  })
})
