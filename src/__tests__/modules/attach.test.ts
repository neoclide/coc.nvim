import { Neovim } from '@chemzqm/neovim'
import events from '../../events'
import Plugin from '../../plugin'
import helper from '../helper'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}
let nvim: Neovim
let plugin: Plugin
beforeAll(async () => {
  await helper.setup()
  plugin = helper.plugin
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('attach', () => {

  it('should listen CocInstalled', () => {
    nvim.emit('notification', 'VimEnter')
    nvim.emit('notification', 'CocInstalled', ['-id'])
  })

  it('should not throw on event handler error', async () => {
    events.on('CursorHold', async () => {
      throw new Error('error')
    })
    let fn = jest.fn()
    nvim.emit('request', 'CocAutocmd', ['CursorHold'], {
      send: fn
    })
    await wait(100)
    expect(fn).toBeCalled()
  })

  it('should not throw when plugin method not found', async () => {
    let fn = jest.fn()
    nvim.emit('request', 'NotExists', [], {
      send: fn
    })
    await wait(100)
    expect(fn).toBeCalled()
  })

  it('should not throw on plugin method error', async () => {
    (plugin as any).errorMethod = async () => {
      throw new Error('error')
    }
    let fn = jest.fn()
    nvim.emit('request', 'errorMethod', [], {
      send: fn
    })
    await wait(100)
    expect(fn).toBeCalled()
  })
})
