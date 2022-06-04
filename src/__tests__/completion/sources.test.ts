import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import workspace from '../../workspace'

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

describe('native sources', () => {

  it('should works for around source', async () => {
    let doc = await workspace.document
    await nvim.setLine('foo ')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('Af')
    await helper.waitPopup()
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<esc>')
  })

  it('should works for buffer source', async () => {
    await helper.createDocument()
    await nvim.command('set hidden')
    let doc = await helper.createDocument()
    await nvim.setLine('other')
    await nvim.command('bp')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('io')
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should works with file source', async () => {
    await helper.edit()
    await nvim.input('i/')
    await helper.waitPopup()
  })
})
