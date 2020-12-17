import { Neovim } from '@chemzqm/neovim'
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

describe('node client pauseNotification', () => {
  it('should work with notify & request', async () => {
    nvim.pauseNotification()
    nvim.call('setline', [1, 'foo'], true)
    nvim.call('append', [1, ['bar']], true)
    await nvim.resumeNotification(false, true)
    await helper.wait(500)
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    expect(lines).toEqual(['foo', 'bar'])
    nvim.pauseNotification()
    nvim.call('eval', ['&buftype'], true)
    nvim.call('bufnr', ['%'], true)
    let res = await nvim.resumeNotification()
    expect(res).toEqual([['', buffer.id], null])
  })
})
