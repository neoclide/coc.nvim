import { Neovim } from '@chemzqm/neovim'
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
  let spy = jest.spyOn(console, 'error').mockImplementation(() => {
    // noop
  })
  await plugin.init('')
  spy.mockRestore()
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
    expect(timeout).toBe(300)
  })

  it('should do Log', () => {
    nvim.emit('notification', 'Log', [])
    nvim.emit('notification', 'redraw', [])
  })

  it('should do notifications', async () => {
    nvim.emit('notification', 'listNames', [])
    let called = false
    let spy = jest.spyOn(console, 'error').mockImplementation(() => {
      called = true
    })
    nvim.emit('notification', 'name_not_exists', [])
    nvim.emit('notification', 'MenuInput', [])
    await helper.waitValue(() => {
      return called
    }, true)
    spy.mockRestore()
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

  it('should echo error instead of throw for autocmds request', async () => {
    let disposable = events.on('CursorHold', async () => {
      throw new Error('my error')
    })
    let s = jest.spyOn(events, 'fire').mockImplementation(() => {
      return Promise.reject(new Error('my error'))
    })
    nvim.call('coc#rpc#request', ['CocAutocmd', ['CursorHold', 1, [1, 1]]], true)
    let spy = jest.spyOn(nvim, 'echoError').mockImplementation(() => {
      called = true
    })
    let called = false
    await helper.waitValue(() => {
      return called
    }, true)
    disposable.dispose()
    s.mockRestore()
    spy.mockRestore()
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
