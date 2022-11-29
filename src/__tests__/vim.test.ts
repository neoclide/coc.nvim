process.env.VIM_NODE_RPC = '1'
import type { Neovim } from '@chemzqm/neovim'
import type { Helper } from './helper'
import type { Window } from '../window'
// make sure VIM_NODE_RPC take effect first
const helper = require('./helper').default as Helper
const window = require('../window').default as Window

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

  it('should show message', async () => {
    window.showMessage('msg')
    let env = helper.workspace.env
    await helper.waitValue(async () => {
      let line = await helper.getCmdline(env.lines - 1)
      return line.includes('msg')
    }, true)
  })
})
