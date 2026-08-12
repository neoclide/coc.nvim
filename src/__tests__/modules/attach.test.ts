import { Neovim } from '@chemzqm/neovim'
import { mock } from 'node:test'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  let plugin = await helper.setup(false)
  nvim = plugin.nvim
  nvim.emit('notification', 'updateConfig', ['suggest.timeout', 300])
  nvim.emit('notification', 'action_not_exists', [])
  let spy = mock.method(console, 'error', () => {
    // noop
  })
  await plugin.init('')
  spy.mock.restore()
})

afterEach(() => {
  disposeAll(disposables)
})

afterAll(async () => {
  await helper.shutdown()
})

describe('notifications', () => {
  it('should notification before plugin ready', () => {
    nvim.emit('notification', 'VimEnter', [''])
    let timeout = workspace.getConfiguration('suggest').get('timeout')
    assert.strictEqual(timeout, 300)
  })

  it('should do Log', () => {
    nvim.emit('notification', 'Log', [])
    nvim.emit('notification', 'redraw', [])
  })

  it('should do notifications', async (t) => {
    nvim.emit('notification', 'listNames', [])
    let called = false
    let spy = t.mock.method(console, 'error', () => {
      called = true
    })
    nvim.emit('notification', 'name_not_exists', [])
    nvim.emit('notification', 'MenuInput', [])
    await helper.waitValue(() => {
      return called
    }, true)
    spy.mock.restore()
  })
})

describe('request', () => {
  it('should get results', async () => {
    let result
    nvim.emit('request', 'listNames', [], {
      send: res => {
        result = res
      }
    })
    await helper.waitValue(() => {
      return Array.isArray(result)
    }, true)
  })

  it('should return error when plugin not ready', async () => {
    let plugin = helper.plugin
    Object.assign(plugin, { ready: false })
    let isErr
    nvim.emit('request', 'listNames', [], {
      send: (_res, isError) => {
        isErr = isError
      }
    })
    await helper.waitValue(() => {
      return isErr
    }, true)
    Object.assign(plugin, { ready: true })
  })

  it('should not throw when plugin method not found', async () => {
    let err
    nvim.emit('request', 'NotExists', [], {
      send: res => {
        err = res
      }
    })
    await helper.waitValue(() => {
      return typeof err === 'string'
    }, true)
  })

  it('should echo error instead of throw for autocmds request', async (t) => {
    let disposable = events.on('CursorHold', async () => {
      throw new Error('my error')
    })
    let s = t.mock.method(events, 'fire', () => {
      return Promise.reject(new Error('my error'))
    })
    nvim.call('coc#rpc#request', ['CocAutocmd', ['CursorHold', 1, [1, 1]]], true)
    let spy = t.mock.method(nvim, 'echoError', () => {
      called = true
    })
    let called = false
    await helper.waitValue(() => {
      return called
    }, true)
    disposable.dispose()
    s.mock.restore()
    spy.mock.restore()
  })
})

describe('attach', () => {
  it('should not throw on event handler error', async () => {
    events.on('CursorHold', () => {
      throw new Error('error')
    })
    let called = false
    nvim.emit('request', 'CocAutocmd', ['CursorHold'], {
      send: () => {
        called = true
      }
    })
    await helper.waitValue(() => {
      return called
    }, true)
  })
})
