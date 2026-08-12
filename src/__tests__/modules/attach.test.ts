import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

let nvim: Neovim
let disposables: Disposable[] = []

before(() => {
  nvim = workspace.nvim
  // Suite-level before hooks have no per-test MockTracker; use the module
  // tracker and restore it after the suite.
  mock.method(console, 'error', () => {
    // noop
  })
})

beforeEach(() => {
  nvim.emit('notification', 'updateConfig', ['suggest.timeout', 300])
  nvim.emit('notification', 'action_not_exists', [])
})

afterEach(() => {
  disposeAll(disposables)
})

after(() => {
  mock.restoreAll()
})

describe('notifications', () => {
  it('should notification before plugin ready', t => {
    nvim.emit('notification', 'VimEnter', [''])
    let timeout = workspace.getConfiguration('suggest').get('timeout')
    assert.strictEqual(timeout, 300)
  })

  it('should do Log', t => {
    nvim.emit('notification', 'Log', [])
    nvim.emit('notification', 'redraw', [])
  })

  it('should do notifications', async t => {
    nvim.emit('notification', 'listNames', [])
    let called = false
    t.mock.method(console, 'error', () => {
      called = true
    })
    nvim.emit('notification', 'name_not_exists', [])
    nvim.emit('notification', 'MenuInput', [])
    await shared.waitValue(() => {
      return called
    }, true)
  })
})

describe('request', () => {
  it('should get results', async t => {
    let result
    nvim.emit('request', 'listNames', [], {
      send: res => {
        result = res
      }
    })
    await shared.waitValue(() => {
      return Array.isArray(result)
    }, true)
  })

  it('should return error when plugin not ready', async t => {
    let plugin = getCurrentPlugin()
    Object.assign(plugin, { ready: false })
    let isErr
    nvim.emit('request', 'listNames', [], {
      send: (_res, isError) => {
        isErr = isError
      }
    })
    await shared.waitValue(() => {
      return isErr
    }, true)
    Object.assign(plugin, { ready: true })
  })

  it('should not throw when plugin method not found', async t => {
    let err
    nvim.emit('request', 'NotExists', [], {
      send: res => {
        err = res
      }
    })
    await shared.waitValue(() => {
      return typeof err === 'string'
    }, true)
  })

  it('should echo error instead of throw for autocmds request', async t => {
    let called = false
    let responded = false
    let fire = events.fire.bind(events)
    t.mock.method(events, 'fire', (event, args) => {
      return event === 'CursorHold' ? Promise.reject(new Error('my error')) : fire(event, args)
    })
    t.mock.method(nvim, 'echoError', () => {
      called = true
    })
    try {
      nvim.emit('request', 'CocAutocmd', ['CursorHold', 1, [1, 1]], {
        send: () => {
          responded = true
        }
      })
      await shared.waitValue(() => called && responded, true)
    } finally {
      t.mock.restoreAll()
    }
  })
})

describe('attach', () => {
  it('should not throw on event handler error', async t => {
    disposables.push(events.on('CursorHold', () => {
      throw new Error('error')
    }))
    let called = false
    nvim.emit('request', 'CocAutocmd', ['CursorHold'], {
      send: () => {
        called = true
      }
    })
    await shared.waitValue(() => {
      return called
    }, true)
  })
})
