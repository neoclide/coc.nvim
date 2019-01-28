import helper from '../helper'
import path from 'path'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'

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

describe('help tags', () => {
  it('should generate help tags', async () => {
    let root = workspace.pluginRoot
    let dir = await nvim.call('fnameescape', path.join(root, 'doc'))
    let res = await nvim.call('execute', `helptags ${dir}`) as string
    expect(res.length).toBe(0)
  })
})
