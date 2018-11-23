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

describe('native sources', () => {

  it('should works for around source', async () => {
    await helper.edit('around')
    await nvim.setLine('foo')
    await helper.wait(100)
    await nvim.input('of')
    await helper.wait(30)
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should works for buffer source', async () => {
    await nvim.command('set hidden')
    await helper.edit('buffer')
    await helper.edit('another')
    await nvim.setLine('other')
    await nvim.command('bp')
    await helper.wait(100)
    await nvim.input('io')
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should works for file source', async () => {
    await helper.edit('file')
    await nvim.input('i/')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBeGreaterThan(0)
    let res = await helper.visible(items[0].word, 'file')
    expect(res).toBe(true)
    await nvim.input('<esc>')
    await nvim.input('o./')
    await helper.waitPopup()
    items = await helper.getItems()
    let item = items.find(o => o.word == 'vimrc')
    expect(item).toBeTruthy()
  })
})
