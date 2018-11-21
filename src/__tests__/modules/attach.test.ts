import path from 'path'
import * as cp from 'child_process'
import attach from '../../attach'
import { Neovim } from '@chemzqm/neovim'
import Plugin from '../../plugin'
import events from '../../events'

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
  const vimrc = path.resolve(__dirname, 'vimrc')
  let proc = cp.spawn('nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
    cwd: __dirname
  })
  plugin = attach({ proc })
  nvim = plugin.nvim
  await wait(300)
  nvim.emit('notification', 'VimEnter')
})

afterAll(async () => {
  await plugin.dispose()
  nvim.quit()
})

afterEach(async () => {
  await wait(30)
  await nvim.command('silent! %bdelete!')
  await wait(30)
})

describe('attach', () => {

  it('should listen CocInstalled', () => {
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
