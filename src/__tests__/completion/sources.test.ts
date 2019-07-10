import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import { ISource, SourceType, CompleteResult } from '../../types'
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

describe('native sources', () => {

  it('should works for around source', async () => {
    await helper.createDocument()
    await nvim.setLine('foo ')
    await helper.wait(100)
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('Af')
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<esc>')
  })

  it('should works for buffer source', async () => {
    await nvim.command('set hidden')
    await helper.createDocument()
    await helper.createDocument()
    await nvim.setLine('other')
    await nvim.command('bp')
    await helper.wait(300)
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('io')
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should works for file source', async () => {
    await helper.edit()
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

  it('should works for file source with other source use same triggerCharacter', async () => {
    await helper.edit()
    let source: ISource = {
      name: 'test',
      priority: 50,
      enable: true,
      firstMatch: false,
      sourceType: SourceType.Native,
      triggerCharacters: ['.', '/'],
      doComplete: async (): Promise<CompleteResult> => {
        let result: CompleteResult = {
          items: [{ word: 'foo' }]
        }
        return Promise.resolve(result)
      }
    }
    let disposable = sources.addSource(source)
    await nvim.input('i.')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBe(1)
    await nvim.input('/')
    await helper.waitPopup()
    items = await helper.getItems()
    expect(items.length).toBeGreaterThan(1)
    expect(items[0].word).toBe('foo')
    disposable.dispose()
  })
})
