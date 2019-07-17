import { Neovim } from '@chemzqm/neovim'
import sources from '../../sources'
import { CompleteResult, ISource, SourceType } from '../../types'
import helper from '../helper'

let nvim: Neovim
let source: ISource
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  source = {
    name: 'float',
    priority: 10,
    enable: true,
    sourceType: SourceType.Native,
    doComplete: (): Promise<CompleteResult> => {
      return Promise.resolve({
        items: [{
          word: 'foo',
          info: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
        }, {
          word: 'foot',
          info: 'foot'
        }, {
          word: 'football',
        }]
      })
    }
  }
  sources.addSource(source)
})

afterAll(async () => {
  sources.removeSource(source)
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('completion float', () => {

  it('should not show float window when disabled', async () => {
    helper.updateConfiguration('suggest.floatEnable', false)
    await helper.edit()
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('f')
    await helper.wait(30)
    await helper.pumvisible()
    helper.updateConfiguration('suggest.floatEnable', true)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should cancel float window', async () => {
    await helper.edit()
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('f')
    await helper.wait(30)
    await helper.pumvisible()
    let items = await helper.getItems()
    expect(items[0].word).toBe('foo')
    expect(items[0].info.length > 0).toBeTruthy()
    await nvim.input('<C-n>')
    await helper.wait(500)
    await nvim.input('<esc>')
    await helper.wait(100)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should adjust float window position', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('A')
    await helper.wait(30)
    await nvim.input('f')
    await helper.visible('foo', 'float')
    await nvim.input('<C-n>')
    await helper.wait(300)
    let floatWin = await helper.getFloat()
    let config = await floatWin.getConfig()
    expect(config.col + config.width).toBeLessThan(80)
  })

  it('should redraw float window on item change', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('A')
    await helper.wait(30)
    await nvim.input('f')
    await helper.visible('foo', 'float')
    await nvim.input('<C-n>')
    await helper.wait(30)
    await nvim.input('<C-n>')
    await helper.wait(100)
    let floatWin = await helper.getFloat()
    let buf = await floatWin.buffer
    let lines = await buf.lines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch('foot')
  })

  it('should hide float window when item info is empty', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('A')
    await helper.wait(30)
    await nvim.input('f')
    await helper.visible('foo', 'float')
    await nvim.input('<C-n>')
    await helper.wait(10)
    await nvim.input('<C-n>')
    await helper.wait(10)
    await nvim.input('<C-n>')
    await helper.wait(100)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should hide float window after completion', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('A')
    await helper.wait(30)
    await nvim.input('f')
    await helper.visible('foo', 'float')
    await nvim.input('<C-n>')
    await helper.wait(100)
    await nvim.input('<C-y>')
    await helper.wait(30)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })
})
