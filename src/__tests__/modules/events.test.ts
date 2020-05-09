import events from '../../events'

describe('register handler', () => {
  it('should register single handler', async () => {
    let fn = jest.fn()
    let obj = {}
    let disposable = events.on('BufEnter', fn, obj)
    await events.fire('BufEnter', ['a', 'b'])
    expect(fn).toBeCalledWith('a', 'b')
    disposable.dispose()
  })

  it('should register multiple events', async () => {
    let fn = jest.fn()
    let disposable = events.on(['TaskExit', 'TaskStderr'], fn)
    await events.fire('TaskExit', [])
    await events.fire('TaskStderr', [])
    expect(fn).toBeCalledTimes(2)
    disposable.dispose()
  })

  it('should resolve before timeout', async () => {
    let fn = (): Promise<void> => new Promise(resolve => {
        setTimeout(() => {
          resolve()
        }, 5000)
      })
    let disposable = events.on('FocusGained', fn, {})
    let ts = Date.now()
    await events.fire('FocusGained', [])
    expect(Date.now() - ts).toBeLessThan(5100)
    disposable.dispose()
  }, 10000)
})
