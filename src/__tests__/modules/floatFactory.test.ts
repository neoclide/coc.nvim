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
    await floatFactory.create(docs)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(1)
    await nvim.call('coc#util#float_hide')
  })

  it('should hide on BufEnter', async () => {
    await helper.edit()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.create(docs)
    await nvim.command(`edit foo`)
    await helper.wait(100)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should hide on InsertLeave', async () => {
    await nvim.input('i')
    await helper.edit()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await floatFactory.create(docs)
    await nvim.input('<esc>')
    await helper.wait(30)
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
    await floatFactory.create(docs)
    let hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(1)
    await helper.wait(30)
    await nvim.input('$')
    await helper.wait(200)
    hasFloat = await nvim.call('coc#util#has_float')
    expect(hasFloat).toBe(0)
  })

  it('should show only one window', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'foo'
    }]
    await Promise.all([
      floatFactory.create(docs),
      floatFactory.create(docs)
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
    await floatFactory.create(docs, true)
    let { mode } = await nvim.mode
    expect(mode).toBe('s')
  })

  it('should get correct height', async () => {
    await helper.createDocument()
    let docs = [{
      filetype: 'txt',
      content: 'Declared in global namespace\n\ntypedef seL4_Uint64 seL4_Word'
    }]
    await floatFactory.create(docs, true)
    let res = await floatFactory.getBoundings(docs)
    expect(res.height).toBe(3)
  })
})
