import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'

let nvim:Neovim
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

describe('completion',() => {
  it('should create channel',  async () => {
    let id = await nvim.getVar('coc_node_channel_id')
    expect(id).toBeGreaterThan(0)
  })

  it('should trigger on first letter insert', async () => {
    await helper.edit('foo')
    await nvim.setLine('foo bar')
    await nvim.input('of')
    await helper.wait(100)
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should trigger on trigger character', async () => {
    await helper.edit('file')
    // trigger file source
    await nvim.input('i./')
    await helper.wait(100)
    let res = await helper.visible('src', 'file')
    expect(res).toBe(true)
  })

  it('should filter and sort on increment search', async () => {
    await helper.edit('search')
    await nvim.setLine('forceDocumentSync format  fallback')
    await nvim.input('of')
    await helper.wait(100)
    let items = await helper.getItems()
    let l = items.length
    await nvim.input('o')
    await helper.wait(100)
    items = await helper.getItems()
    expect(items.findIndex(o => o.word == 'fallback')).toBe(-1)
    expect(items.length).toBeLessThan(l)
  })

  it('should filter on character remove by backspace', async () => {
    await helper.edit('remove')
    await nvim.setLine('forceDocumentSync format  fallback')
    await nvim.input('ofa')
    await helper.wait(100)
    let items = await helper.getItems()
    let words = items.map(o => o.word)
    expect(words).toEqual(['fallback', 'format'])
    await nvim.input('<backspace>')
    await helper.wait(100)
    items = await helper.getItems()
    words = items.map(o => o.word)
    expect(words).toEqual(['format', 'fallback', 'forceDocumentSync'])
  })

  it('should filter on fix back backspace', async () => {
    await helper.edit('backspace')
    await nvim.setLine('backspace')
    await helper.wait(20)
    await nvim.input('obackspac')
    await helper.wait(30)
    await nvim.input('e')
    await helper.wait(100)
    let visible = await nvim.call('pumvisible')
    expect(visible).toBe(1)
    await helper.wait(100)
    await nvim.input('q')
    await helper.wait(100)
    visible = await nvim.call('pumvisible')
    expect(visible).toBe(0)
    await nvim.input('<backspace>')
    await helper.wait(100)
    let res = await helper.visible('backspace', 'around')
    expect(res).toBe(true)
  })

  it('should trigger on insert enter', async () => {
    await helper.edit('insert')
    await nvim.setLine('foo bar')
    await nvim.input('of')
    await nvim.command('stopinsert')
    await helper.wait(30)
    await nvim.input('A')
    await helper.wait(100)
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should filter on fast input', async () => {
    await helper.edit('insert')
    await nvim.setLine('foo bar')
    await nvim.input('ob')
    await helper.wait(40)
    await nvim.input('r')
    await helper.wait(100)
    let mode = await nvim.mode
    expect(mode.mode).toBe('ic')
    let items = await helper.getItems()
    expect(items.length).toBe(1)
    expect(items[0].word).toBe('bar')
  })

  it('should not show word of word source on empty input', async () => {
    await helper.edit('insert')
    await helper.wait(100)
    await nvim.setLine('foo bar')
    await nvim.input('of')
    await helper.wait(200)
    let mode = await nvim.mode
    expect(mode.mode).toBe('ic')
    await nvim.input('<backspace>')
    await helper.wait(100)
    let res = await helper.pumvisible()
    expect(res).toBe(false)
  })
})
