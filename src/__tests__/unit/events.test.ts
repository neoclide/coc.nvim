import { isDeepStrictEqual } from 'node:util'
import { setTimeout as wait } from 'node:timers/promises'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'

const disposables: Disposable[] = []
afterEach(async () => {
  disposeAll(disposables)
})

describe('register handler', () => {
  it('should fire InsertEnter and InsertLeave when necessary', async (t) => {
    let fn = t.mock.fn()
    events.on('InsertEnter', fn, null, disposables)
    events.on('InsertLeave', fn, null, disposables)
    assert.strictEqual(events.pumvisible, false)
    assert.strictEqual(events.insertMode, false)
    await events.fire('CursorMovedI', [1, [1, 1]])
    assert.strictEqual(events.insertMode, false)
    await events.fire('CursorMoved', [1, [1, 1]])
    assert.strictEqual(events.insertMode, false)
    assert.strictEqual((fn).mock.callCount(), 2)
  })

  it('should fire only once', async (t) => {
    let fn = t.mock.fn()
    events.once('ready', () => {
      fn()
    })
    await events.fire('ready', [])
    await events.fire('ready', [])
    await events.fire('ready', [])
    assert.strictEqual((fn).mock.callCount(), 1)
  })

  it('should fire visible event once', async (t) => {
    let fn = t.mock.fn()
    let event
    events.once('WindowVisible', ev => {
      event = ev
      fn()
    })
    await events.fire('BufWinEnter', [1, 1000, [1, 2]])
    await events.fire('WinScrolled', [1000, 2, [2, 3]])
    await wait(20)
    await events.fire('WinClosed', [1000])
    assert.strictEqual((fn).mock.callCount(), 1)
    assert.deepStrictEqual(event, { bufnr: 2, winid: 1000, region: [2, 3] })
  })

  it('should cancel visible event', async (t) => {
    let fn = t.mock.fn()
    events.once('WindowVisible', () => {
      fn()
    })
    await events.fire('BufWinEnter', [1, 1000])
    await events.fire('WinClosed', [1000])
    await wait(20)
    assert.strictEqual((fn).mock.callCount(), 0)
  })

  it('should track slow handler', async () => {
    events.on('BufWritePre', async () => {
      await wait(50)
    }, null, disposables)
    events.timeout = 20
    events.requesting = true
    await events.fire('BufWritePre', [1, '', 1])
    events.requesting = false
    events.timeout = 1000
  })

  it('should on throw on handler error', async () => {
    events.on('BufWritePre', async () => {
      throw new Error('test error')
    }, null, disposables)
    events.on('BufWritePre', () => {
      throw new CancellationError()
    }, null, disposables)
    await events.fire('BufWritePre', [1, '', 1])
  })

  it('should register single handler', async (t) => {
    let fn = t.mock.fn()
    let obj = {}
    let disposable = events.on('BufEnter', fn, obj)
    disposables.push(disposable)
    await events.fire('BufEnter', ['a', 'b'])
    assert.ok((fn).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['a', 'b'])))
  })

  it('should register multiple events', async (t) => {
    let fn = t.mock.fn()
    let disposable = events.on(['TaskExit', 'TaskStderr'], fn)
    disposables.push(disposable)
    await events.fire('TaskExit', [])
    await events.fire('TaskStderr', [])
    assert.strictEqual((fn).mock.callCount(), 2)
  })

  it('should resolve after timeout', async () => {
    let fn = (): Promise<void> => new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, 20)
    })
    let disposable = events.on('FocusGained', fn, {})
    disposables.push(disposable)
    let ts = Date.now()
    await events.fire('FocusGained', [])
    assert.strictEqual(Date.now() - ts >= 10, true)
  })

  it('should emit TextInsert after TextChangedI', async () => {
    let arr: string[] = []
    events.on('TextInsert', () => {
      arr.push('insert')
    }, null, disposables)
    events.on('TextChangedI', () => {
      arr.push('change')
    }, null, disposables)
    await events.fire('InsertCharPre', ['i', 1])
    await events.fire('TextChangedI', [1, {
      lnum: 1,
      col: 2,
      pre: 'i',
      changedtick: 1,
      line: 'i'
    }])
    assert.notStrictEqual(events.lastChangeTs, undefined)
    await events.race(['TextInsert'])
    assert.deepStrictEqual(arr, ['change', 'insert'])
    await events.fire('ModeChanged', [{ old_mode: 'n', new_mode: 'i' }])
    assert.notStrictEqual(events.mode, undefined)
  })

  it('should race events', async () => {
    let p = events.race(['InsertCharPre', 'TextChangedI', 'MenuPopupChanged'])
    await events.fire('InsertCharPre', ['i', 1])
    await events.fire('TextChangedI', [1, {
      lnum: 1,
      col: 2,
      pre: 'i',
      changedtick: 1
    }])
    let res = await p
    assert.strictEqual(res.name, 'InsertCharPre')
    res = await events.race(['TextChanged'], 50)
    assert.strictEqual(res, undefined)
  })

  it('should race same events', async () => {
    let arr: any[] = []
    void events.race(['TextChangedI'], 200).then(res => {
      arr.push(res)
    })
    void events.race(['TextChangedI'], 200).then(res => {
      arr.push(res)
    })
    await events.fire('TextChangedI', [2, {}])
    assert.strictEqual(arr.length, 2)
    assert.deepStrictEqual(arr.map(o => o.name), ['TextChangedI', 'TextChangedI'])
  })

  it('should cancel race by CancellationToken', async () => {
    let tokenSource = new CancellationTokenSource()
    setTimeout(() => {
      tokenSource.cancel()
    }, 20)
    let res = await events.race(['TextChanged'], tokenSource.token)
    assert.strictEqual(res, undefined)
  })
})
