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

describe('completion', () => {
  it('should create channel', async () => {
    let id = await nvim.getVar('coc_node_channel_id')
    expect(id).toBeGreaterThan(0)
  })

  it('should not show word of word source on empty input', async () => {
    await helper.edit('insert')
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('of')
    await helper.waitPopup()
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<backspace>')
    await helper.wait(1000)
    res = await helper.notVisible('foo')
    expect(res).toBe(true)
  })

  it('should trigger on first letter insert', async () => {
    await helper.edit('foo')
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('of')
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should trigger on trigger character', async () => {
    await helper.edit('file')
    // trigger file source
    await nvim.input('i./')
    let res = await helper.visible('coc-settings.json', 'file')
    expect(res).toBe(true)
  })

  it('should filter and sort on increment search', async () => {
    await helper.edit('search')
    await nvim.setLine('forceDocumentSync format  fallback')
    await helper.wait(30)
    await nvim.input('of')
    await helper.waitPopup()
    let items = await helper.getItems()
    let l = items.length
    await nvim.input('oa')
    await helper.wait(100)
    items = await helper.getItems()
    expect(items.findIndex(o => o.word == 'fallback')).toBe(-1)
    expect(items.length).toBeLessThan(l)
  })

  it('should filter on character remove by backspace', async () => {
    await helper.edit('remove')
    await nvim.setLine('forceDocumentSync format  fallback')
    await helper.wait(30)
    await nvim.input('ofa')
    await helper.waitPopup()
    let items = await helper.getItems()
    let words = items.map(o => o.word)
    expect(words).toEqual(['fallback', 'format'])
    await nvim.input('<backspace>')
    await helper.wait(100)
    items = await helper.getItems()
    words = items.map(o => o.word)
    expect(words).toEqual(['format', 'fallback', 'forceDocumentSync'])
  })

  it('should not trigger on insert enter', async () => {
    await helper.edit('insert')
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('o')
    let visible = await nvim.call('pumvisible')
    expect(visible).toBe(0)
  })

  it('should filter on fast input', async () => {
    await helper.edit('insert')
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('ob')
    await helper.wait(30)
    await nvim.input('a')
    await helper.waitPopup()
    let items = await helper.getItems()
    let item = items.find(o => o.word == 'foo')
    expect(item).toBeFalsy()
    expect(items[0].word).toBe('bar')
  })
})
