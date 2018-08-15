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
    await helper.wait(30)
    await nvim.input('of')
    await helper.wait(100)
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
  })

  it('should works for dictionary source', async () => {
    await helper.edit('dictionary')
    await nvim.call('SetDictionary')
    let buf = await nvim.buffer
    let dict = await buf.getOption('dictionary') as string
    expect(dict.indexOf('test.dict') !== -1).toBeTruthy()
    await nvim.input('id')
    await helper.wait(100)
    let res = await helper.visible('dictionary', 'dictionary')
    expect(res).toBe(true)
  })

  it('should works for buffer source', async () => {
    await nvim.command('set hidden')
    await helper.edit('buffer')
    await helper.edit('another')
    await nvim.setLine('other')
    await nvim.command('bp')
    await helper.wait(30)
    await nvim.input('io')
    await helper.wait(100)
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should works for omni source', async () => {
    let buf = await helper.edit('omni.vim')
    await nvim.command('setf vim')
    await nvim.input('icom')
    await helper.wait(600)
    let opt = await buf.getOption('omnifunc') as string
    expect(opt).toBe('syntaxcomplete#Complete')
    let res = await helper.visible('command', 'omni')
    expect(res).toBe(true)
  })

  it('should works for tag source', async () => {
    await helper.edit('tag')
    await nvim.input('iunb')
    await helper.wait(600)
    let res = await helper.visible('unbind', 'tag')
    expect(res).toBe(true)
  })

  it('should works for file source', async () => {
    await helper.edit('file')
    await nvim.input('i/')
    await helper.wait(100)
    let items = await helper.getItems()
    expect(items.length).toBeGreaterThan(0)
    let res = await helper.visible(items[0].word, 'file')
    expect(res).toBe(true)
    await helper.reset()
    await nvim.input('i./')
    await helper.wait(100)
    items = await helper.getItems()
    let item = items.find(o => o.word == 'vimrc')
    expect(item).toBeTruthy()
  })

  it('should works for emoji source', async () => {
    await helper.edit('emoji')
    await helper.wait(30)
    await nvim.input('ismil')
    await helper.wait(30)
    await nvim.input('<C-u>')
    await helper.wait(100)
    let res = await helper.visible('😄', 'emoji')
    expect(res).toBe(true)
  })

  it('should works for word source', async () => {
    let s = 'strengthening'
    await helper.edit('word')
    await nvim.input('i' + s.slice(0, -1))
    await helper.wait(100)
    await nvim.input('<C-u>')
    await helper.wait(100)
    let res = await helper.visible(s, 'word')
    expect(res).toBe(true)
  })

  it('should works for include source', async () => {
    await helper.edit('word')
    await nvim.input('icombas')
    await helper.wait(100)
    await nvim.input('<C-u>')
    await helper.wait(600)
    let res = await helper.visible('./completion/basic.test.ts', 'include')
    expect(res).toBe(true)
  })
})

describe('remote sources', () => {
  it('should works for neosnippet source', async () => {
    await helper.edit('neosnippet')
    await helper.wait(100)
    await nvim.input('ineo')
    await helper.wait(200)
    let res = await helper.visible('neosnippet', 'neosnippet')
    expect(res).toBe(true)
  })

  it('should works for neco source', async () => {
    let buf = await helper.edit('neco.vim')
    await buf.setOption('omnifunc', '')
    await helper.wait(100)
    await nvim.input('ine')
    await helper.wait(200)
    let res = await helper.visible('neco', 'neco')
    expect(res).toBe(true)
  })

  it('should works for ultisnips source', async () => {
    await helper.edit('ultisnips')
    await helper.wait(30)
    await nvim.input('iulti')
    await helper.wait(200)
    let res = await helper.visible('ultisnips', 'ultisnips')
    expect(res).toBe(true)
  })
})

describe('service source', () => {

  it('should works for tsserver source', async () => {
    await helper.edit('tmp.ts')
    await helper.onServiceReady('tsserver')
    // need sometime for initialize completion
    await helper.wait(4000)
    await nvim.setLine('notDeepEqu')
    await nvim.input('Aa')
    await helper.wait(500)
    let res = await helper.visible('notDeepEqual', 'tsserver-typescript')
    expect(res).toBe(true)
  })

})
