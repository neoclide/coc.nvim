import { EXIT_TIMEOUT, gracefulExit, setExitHook } from '../../exit'
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
    gracefulExit('SIGTERM')
    await vi.waitFor(() => {
      expect(exitCode).toBe(0)
    })
    expect(stopSpy).toHaveBeenCalledWith(EXIT_TIMEOUT)
  })

  it('should exit on timeout when stop hangs', async () => {
    stopSpy = vi.spyOn(services, 'stopAll').mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      gracefulExit('SIGTERM')
      await vi.advanceTimersByTimeAsync(EXIT_TIMEOUT)
      expect(exitCode).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
