import { Neovim } from '@chemzqm/neovim'
import Floating from '../../completion/floating'
import { getInsertWord, prefixWord } from '../../completion/pum'
import sources from '../../completion/sources'
import { CompleteResult, ExtendedCompleteItem, ISource, SourceType } from '../../completion/types'
import { FloatConfig } from '../../types'
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
    doComplete: (): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
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
  it('should prefix word', () => {
    expect(prefixWord('foo', 0, '', 0)).toBe('foo')
    expect(prefixWord('foo', 1, '$foo', 0)).toBe('$foo')
  })

  it('should get insert word', () => {
    expect(getInsertWord('word', [], 0)).toBe('word')
    expect(getInsertWord('word\nbar', [10], 2)).toBe('word')
  })

  it('should cancel float window', async () => {
    await helper.edit()
    await nvim.setLine('f')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'float' }, true)
    await helper.waitPopup()
    await helper.confirmCompletion(0)
    let hasFloat = await nvim.call('coc#float#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should adjust float window position', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    let floatWin = await helper.getFloat('pumdetail')
    let config = await floatWin.getConfig()
    expect(config.col + config.width).toBeLessThan(180)
  })

  it('should redraw float window on item change', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await nvim.call('coc#pum#select', [1, 1, 0])
    let floatWin = await helper.getFloat('pumdetail')
    let buf = await floatWin.buffer
    let lines = await buf.lines
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch('foot')
  })

  it('should hide float window when item info is empty', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await nvim.call('coc#pum#select', [2, 1, 0])
    let floatWin = await helper.getFloat('pumdetail')
    expect(floatWin).toBeUndefined()
  })

  it('should hide float window after completion', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await nvim.input('<C-n>')
    await helper.wait(30)
    await nvim.input('<C-y>')
    await helper.wait(30)
    let floatWin = await helper.getFloat('pumdetail')
    expect(floatWin).toBeUndefined()
  })
})

describe('float config', () => {
  beforeEach(async () => {
    await nvim.input('of')
    await helper.waitPopup()
  })

  async function createFloat(config: Partial<FloatConfig>, docs = [{ filetype: 'txt', content: 'doc' }]): Promise<Floating> {
    let floating = new Floating({
      floatConfig: {
        border: true,
        ...config
      }
    })
    floating.show(docs)
    return floating
  }

  async function getFloat(): Promise<number> {
    let win = await helper.getFloat('pumdetail')
    return win ? win.id : -1
  }

  async function getRelated(winid: number, kind: string): Promise<number> {
    if (!winid || winid == -1) return -1
    let win = nvim.createWindow(winid)
    let related = await win.getVar('related') as number[]
    if (!related || !related.length) return -1
    for (let id of related) {
      let w = nvim.createWindow(id)
      let v = await w.getVar('kind')
      if (v == kind) {
        return id
      }
    }
    return -1
  }

  it('should not shown with empty lines', async () => {
    await createFloat({}, [{ filetype: 'txt', content: '' }])
    let floatWin = await helper.getFloat('pumdetail')
    expect(floatWin).toBeUndefined()
  })

  it('should show window with border', async () => {
    await createFloat({ border: true, rounded: true, focusable: true })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
  })

  it('should change window highlights', async () => {
    await createFloat({ border: true, highlight: 'WarningMsg', borderhighlight: 'MoreMsg' })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let win = nvim.createWindow(winid)
    let res = await win.getOption('winhl') as string
    expect(res).toMatch('WarningMsg')
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
    win = nvim.createWindow(id)
    res = await win.getOption('winhl') as string
    expect(res).toMatch('MoreMsg')
  })

  it('should add shadow and winblend', async () => {
    await createFloat({ shadow: true, winblend: 30 })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
  })
})
