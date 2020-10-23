import { Neovim } from '@chemzqm/neovim'
import FloatFactory from '../../model/floatFactory'
import snippetManager from '../../snippets/manager'
import { Documentation } from '../../types'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let floatFactory: FloatFactory
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  floatFactory = new FloatFactory(nvim, workspace.env, false, 8)
})

afterAll(async () => {
  await helper.shutdown()
  floatFactory.dispose()
})

afterEach(async () => {
  await helper.reset()
})

describe('FloatFactory', () => {

  it('should create', async () => {
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'f'.repeat(81)
    }]
    let called = false
    let fn = (winid, bufnr) => {
      called = true
      expect(floatFactory.bufnr).toBe(bufnr)
      expect(floatFactory.window.id).toBe(winid)
    }
    floatFactory.on('show', fn)
    await floatFactory.show(docs)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(1)
    await nvim.call('coc#util#float_hide')
    floatFactory.removeListener('show', fn)
    expect(called).toBe(true)
  })

  it('should respect prefer top', async () => {
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo\nbar'
    }]
    await nvim.call('append', [1, ['', '', '']])
    await nvim.command('exe 4')
    await floatFactory.show(docs, { preferTop: true })
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let pos = await nvim.call('nvim_win_get_position', [win.id])
    expect(pos).toEqual([1, 0])
  })

  it('should hide on BufEnter', async () => {
    await helper.edit()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.show(docs)
    await nvim.command(`edit foo`)
    await helper.wait(100)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should hide on CursorMoved', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.show(docs)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(1)
    await helper.wait(30)
    await nvim.input('$')
    await helper.wait(500)
    hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should not hide when cursor position not changed', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    let cursor = await nvim.eval("[line('.'), col('.')]")
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.show(docs)
    await nvim.call('cursor', [1, 2])
    await helper.wait(10)
    await nvim.call('cursor', cursor)
    await helper.wait(300)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(1)
  })

  it('should show only one window', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await Promise.all([
      floatFactory.show(docs),
      floatFactory.show(docs)
    ])
    await helper.wait(30)
    let count = 0
    let wins = await nvim.windows
    for (let win of wins) {
      let isFloat = await win.getVar('float')
      if (isFloat) count++
    }
    expect(count).toBe(1)
  })

  it('should allow select mode', async () => {
    await helper.createDocument()
    await snippetManager.insertSnippet('${1:foo}')
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.show(docs, { allowSelection: true })
    let { mode } = await nvim.mode
    expect(mode).toBe('s')
  })

  it('should get active state of window', async () => {
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'f'.repeat(81)
    }]
    await floatFactory.show(docs)
    let res = await floatFactory.activated()
    expect(res).toBe(true)
    await nvim.call('coc#util#float_hide')
    res = await floatFactory.activated()
    expect(res).toBe(false)
  })
})
