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

  it('should return jumpable', async () => {
    let jumpable = await helper.plugin.snippetCheck(false, true)
    expect(jumpable).toBe(false)
  })

  it('should show CocInfo', async () => {
    await helper.plugin.showInfo()
    await helper.wait(300)
    let line = await nvim.line
    expect(line).toMatch('versions')
  })
})
