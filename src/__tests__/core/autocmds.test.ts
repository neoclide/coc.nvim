import { Neovim } from '@chemzqm/neovim'
import { createCommand } from '../../core/autocmds'
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

describe('setupDynamicAutocmd()', () => {
  it('should create command', async () => {
    let callback = () => {}
    expect(createCommand(1, { callback, event: 'event', arglist: [], pattern: '*', request: true })).toMatch('event')
    expect(createCommand(1, { callback, event: 'event', arglist: ['foo'] })).toMatch('foo')
    expect(createCommand(1, { callback, event: ['foo', 'bar'], arglist: [] })).toMatch('foo')
    expect(createCommand(1, { callback, event: 'user Event', arglist: [] })).toMatch('user')
  })

  it('should setup autocmd on vim', async () => {
    await nvim.setLine('foo')
    let called = false
    let disposable = workspace.registerAutocmd({
      event: 'CursorMoved',
      request: true,
      callback: () => {
        called = true
      }
    })
    await helper.wait(10)
    await nvim.command('normal! $')
    await helper.waitValue(() => called, true)
    expect(called).toBe(true)
    disposable.dispose()
  })

  it('should setup user autocmd', async () => {
    let called = false
    workspace.registerAutocmd({
      event: 'User CocJumpPlaceholder',
      request: true,
      callback: () => {
        called = true
      }
    })
    workspace.autocmds.resetDynamicAutocmd()
    await helper.wait(10)
    await nvim.command('doautocmd <nomodeline> User CocJumpPlaceholder')
    await helper.waitValue(() => called, true)
  })
})

describe('doAutocmd()', () => {
  it('should not throw when command id does not exist', async () => {
    await workspace.autocmds.doAutocmd(999, [])
  })

  it('should dispose', async () => {
    workspace.autocmds.dispose()
  })
})
