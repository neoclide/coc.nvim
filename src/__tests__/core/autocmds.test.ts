import { Neovim } from '@chemzqm/neovim'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('setupDynamicAutocmd()', () => {
  it('should setup autocmd on vim', async () => {
    await nvim.setLine('foo')
    let fn = nvim.hasFunction
    nvim.hasFunction = () => {
      return false
    }
    let called = false
    workspace.registerAutocmd({
      event: 'CursorMoved',
      request: true,
      callback: () => {
        called = true
      }
    })
    await helper.wait(50)
    await nvim.command('normal! $')
    await helper.wait(100)
    nvim.hasFunction = fn
    expect(called).toBe(true)
    nvim.command(`augroup coc_dynamic_autocmd|  autocmd!|augroup end`, true)
  })
})

describe('doAutocmd()', () => {
  it('should not throw when command id not exists', async () => {
    await workspace.autocmds.doAutocmd(999, [])
  })
})
