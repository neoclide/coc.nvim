import os from 'os'
import helper from '../helper'
import Plugin from '../../plugin'
import { Neovim } from '@chemzqm/neovim'

let plugin: Plugin
let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  plugin = helper.plugin
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('plugin', () => {
  it('should prompt for install coc-json', async () => {
    let home = os.homedir()
    await nvim.command(`edit ${home}/.vim/coc-settings.json`)
    await helper.wait(30)
    let line = await helper.screenLine(79)
    expect(line).toMatch(/coc-json/)
    await nvim.input('n')
  })

  it('should open log', async () => {
    await plugin.openLog()
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toMatch(/coc-nvim\.log/)
  })

  it('should regist extensions', async () => {
    await plugin.registExtensions('/tmp/coc')
    let line = await helper.screenLine(79)
    expect(line).toMatch("not found")
  })
})
