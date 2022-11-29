process.env.VIM_NODE_RPC = '1'
import type { Neovim } from '@chemzqm/neovim'
import type { Helper } from './helper'
// make sure VIM_NODE_RPC take effect first
const helper = require('./helper').default as Helper

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
