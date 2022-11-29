process.env.VIM_NODE_RPC = '1'
import type { Neovim } from '@chemzqm/neovim'
import helper from './helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setupVim()
  nvim = helper.workspace.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('vim api', () => {
  it('should start server', async () => {
    await nvim.setLine('foobar')
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['foobar'])
  })
})
