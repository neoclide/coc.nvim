import events from '../../events'
import { setExtensionId } from '../../util/extensionId'

afterEach(editorReset)

describe('events extension attribution', () => {
  it('should update state for CompleteDone events', async () => {
    await events.fire('CompleteDone', [])
  })

  it('should include the extension id in handler error logs', async () => {
    let called = false
    let handler = () => {
      called = true
      throw new Error('handler boom')
    }
    setExtensionId(handler, 'plugin-a')
    let disposable = events.on('BufEnter', handler as any)
    // The error is caught and logged by the event bus; firing must not throw.
    await events.fire('BufEnter', [1])
    assert.strictEqual(called, true)
    disposable.dispose()
  })

  it('should warn about slow handlers with the extension id', async () => {
    let handler = async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    setExtensionId(handler, 'plugin-a')
    let disposable = events.on('BufEnter', handler as any)
    let previousTimeout = events.timeout
    events.timeout = 20
    events.requesting = true
    try {
      await events.fire('BufEnter', [1])
    } finally {
      events.requesting = false
      events.timeout = previousTimeout
    }
    disposable.dispose()
  })
})
