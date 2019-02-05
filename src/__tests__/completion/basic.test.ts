import { Neovim } from '@chemzqm/neovim'
import { ISource, SourceType, CompleteResult } from '../../types'
import helper from '../helper'
import sources from '../../sources'

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

  it('should not show word of word source on empty input', async () => {
    await helper.edit()
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('of')
    await helper.waitPopup()
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<backspace>')
    await helper.wait(100)
    res = await helper.notVisible('foo')
    expect(res).toBe(true)
  })

  it('should trigger on first letter insert', async () => {
    await helper.edit()
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('of')
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should trigger on force refresh', async () => {
    await helper.edit()
    await nvim.setLine('foo f')
    await helper.wait(100)
    await nvim.input('A')
    await helper.wait(10)
    await nvim.call('coc#start')
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should filter and sort on increment search', async () => {
    await helper.edit()
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
    await helper.edit()
    await nvim.setLine('forceDocumentSync format  fallback')
    await helper.wait(30)
    await nvim.input('ofa')

    await helper.waitPopup()
    let items = await helper.getItems()
    let words = items.map(o => o.word)
    expect(words).toContain('fallback')
    expect(words).toContain('format')
    await nvim.input('<backspace>')
    await helper.wait(100)
    items = await helper.getItems()
    words = items.map(o => o.word)
    expect(words).toEqual([])
  })

  it('should not trigger on insert enter', async () => {
    await helper.edit()
    await nvim.setLine('foo bar')
    await helper.wait(30)
    await nvim.input('o')
    let visible = await nvim.call('pumvisible')
    expect(visible).toBe(0)
  })

  it('should filter on fast input', async () => {
    await helper.edit()
    await nvim.setLine('foo bar')
    await helper.wait(60)
    await nvim.input('oba')
    await helper.waitPopup()
    let items = await helper.getItems()
    let item = items.find(o => o.word == 'foo')
    expect(item).toBeFalsy()
    expect(items[0].word).toBe('bar')
  })

  it('should fix start column', async () => {
    await helper.edit()
    let source: ISource = {
      name: 'test',
      priority: 10,
      enable: true,
      firstMatch: false,
      sourceType: SourceType.Native,
      triggerCharacters: [],
      doComplete: async (): Promise<CompleteResult> => {
        let result: CompleteResult = {
          startcol: 0,
          items: [{ word: 'foo.bar' }]
        }
        return Promise.resolve(result)
      }
    }
    sources.addSource(source)
    await nvim.setLine('foo.')
    await nvim.input('Ab')
    await helper.waitPopup()
    let val = await nvim.getVar('coc#_context') as any
    expect(val.start).toBe(0)
  })

  it('should trigger on triggerCharacters', async () => {
    await helper.edit()
    let source: ISource = {
      name: 'trigger',
      priority: 10,
      enable: true,
      sourceType: SourceType.Native,
      triggerCharacters: ['.'],
      doComplete: async (): Promise<CompleteResult> => {
        return Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
    }
    sources.addSource(source)
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('.')
    await helper.waitPopup()
    sources.removeSource(source)
    let res = await helper.visible('foo', 'trigger')
    expect(res).toBe(true)
  })

  it('should trigger when backspace to triggerCharacter', async () => {
    await helper.edit()
    let source: ISource = {
      name: 'trigger',
      priority: 10,
      enable: true,
      sourceType: SourceType.Native,
      triggerCharacters: ['.'],
      doComplete: async (): Promise<CompleteResult> => {
        return Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
    }
    sources.addSource(source)
    await nvim.setLine('.a')
    await nvim.input('A')
    await nvim.eval('feedkeys("\\<bs>")')
    let res = await helper.visible('foo', 'trigger')
    expect(res).toBe(true)
    sources.removeSource(source)
  })

  it('should not trigger when cursor moved', async () => {
    await helper.edit()
    let source: ISource = {
      name: 'trigger',
      priority: 10,
      enable: true,
      sourceType: SourceType.Native,
      triggerCharacters: ['.'],
      doComplete: async (): Promise<CompleteResult> => {
        return Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
    }
    sources.addSource(source)
    await nvim.setLine('.a')
    await nvim.input('A')
    await nvim.eval('feedkeys("\\<bs>")')
    await helper.wait(10)
    await nvim.eval('feedkeys("\\<left>")')
    await helper.wait(200)
    let visible = await nvim.call('pumvisible')
    expect(visible).toBe(0)
    sources.removeSource(source)
  })
})
