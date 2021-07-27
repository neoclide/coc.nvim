import { Neovim } from '@chemzqm/neovim'
import { Range } from 'vscode-languageserver-types'
import Cursors from '../../cursors'
import Document from '../../model/document'
import helper from '../helper'

let nvim: Neovim
let cursors: Cursors
let ns: number

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  ns = await nvim.createNamespace('coc-cursors')
  cursors = new Cursors(nvim)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  nvim.pauseNotification()
  cursors.reset()
  await nvim.resumeNotification()
  await helper.reset()
})

async function rangeCount(): Promise<number> {
  let buf = await nvim.buffer
  let markers = await helper.getMarkers(buf.id, ns)
  return markers.length
}

describe('cursors#select', () => {

  it('should select by position', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['a', 'b']])
    await nvim.call('cursor', [1, 1])
    await helper.wait(100)
    doc.forceSync()
    await helper.wait(100)
    await cursors.select(doc.bufnr, 'position', 'n')
    await helper.wait(30)
    let n = await rangeCount()
    expect(n).toBe(1)
    await nvim.setOption('virtualedit', 'onemore')
    await nvim.call('cursor', [2, 2])
    await cursors.select(doc.bufnr, 'position', 'n')
    n = await rangeCount()
    expect(n).toBe(2)
    await cursors.select(doc.bufnr, 'position', 'n')
    n = await rangeCount()
    expect(n).toBe(1)
  })

  it('should select by word', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['foo', 'bar']])
    await nvim.call('cursor', [1, 1])
    await helper.wait(30)
    doc.forceSync()
    await cursors.select(doc.bufnr, 'word', 'n')
    let n = await rangeCount()
    expect(n).toBe(1)
    await nvim.call('cursor', [2, 2])
    await cursors.select(doc.bufnr, 'word', 'n')
    n = await rangeCount()
    expect(n).toBe(2)
    await cursors.select(doc.bufnr, 'word', 'n')
    n = await rangeCount()
    expect(n).toBe(1)
  })

  it('should select last character', async () => {
    let doc = await helper.createDocument()
    await nvim.setOption('virtualedit', 'onemore')
    await nvim.call('setline', [1, ['}', '{']])
    await nvim.call('cursor', [1, 2])
    await helper.wait(30)
    doc.forceSync()
    await cursors.select(doc.bufnr, 'word', 'n')
    let n = await rangeCount()
    expect(n).toBe(1)
    await nvim.call('cursor', [2, 1])
    await helper.wait(30)
    doc.forceSync()
    await cursors.select(doc.bufnr, 'word', 'n')
    n = await rangeCount()
    expect(n).toBe(2)
  })

  it('should select by visual range', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['"foo"', '"bar"']])
    await nvim.call('cursor', [1, 1])
    await nvim.command('normal! vE')
    await helper.wait(30)
    doc.forceSync()
    await cursors.select(doc.bufnr, 'range', 'v')
    let n = await rangeCount()
    expect(n).toBe(1)
    await nvim.call('cursor', [2, 1])
    await nvim.command('normal! vE')
    await cursors.select(doc.bufnr, 'range', 'v')
    n = await rangeCount()
    expect(n).toBe(2)
    await cursors.select(doc.bufnr, 'range', 'v')
    n = await rangeCount()
    expect(n).toBe(1)
  })

  it('should select by operator', async () => {
    await nvim.command('nmap x  <Plug>(coc-cursors-operator)')
    await helper.createDocument()
    await nvim.call('setline', [1, ['"short"', '"long"']])
    await nvim.call('cursor', [1, 2])
    await nvim.input('xa"')
    await helper.wait(30)
    await nvim.call('cursor', [2, 2])
    await nvim.input('xa"')
    await helper.wait(30)
    await nvim.command('nunmap x')
  })
})

describe('cursors#addRanges', () => {
  it('should add ranges', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['foo foo foo', 'bar bar']])
    await helper.wait(30)
    doc.forceSync()
    let ranges = [
      Range.create(0, 0, 0, 3),
      Range.create(0, 4, 0, 7),
      Range.create(0, 8, 0, 11),
      Range.create(1, 0, 1, 3),
      Range.create(1, 4, 1, 7)
    ]
    await cursors.addRanges(ranges)
    let n = await rangeCount()
    expect(n).toBe(5)
  })
})

describe('cursors#onchange', () => {

  async function setup(): Promise<Document> {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['foo foo foo', 'bar bar']])
    await helper.wait(30)
    doc.forceSync()
    let ranges = [
      Range.create(0, 0, 0, 3),
      Range.create(0, 4, 0, 7),
      Range.create(0, 8, 0, 11),
      Range.create(1, 0, 1, 3),
      Range.create(1, 4, 1, 7)
    ]
    await cursors.addRanges(ranges)
    await nvim.call('cursor', [1, 1])
    return doc
  }

  it('should ignore change after last range', async () => {
    let doc = await setup()
    await doc.buffer.append(['append'])
    doc.forceSync()
    await helper.wait(50)
    let n = await rangeCount()
    expect(n).toBe(5)
  })

  it('should adjust ranges on change before first line', async () => {
    let doc = await setup()
    await doc.buffer.setLines(['prepend'], { start: 0, end: 0, strictIndexing: false })
    doc.forceSync()
    await helper.wait(200)
    let n = await rangeCount()
    expect(n).toBe(5)
    await nvim.call('cursor', [2, 1])
    await nvim.input('ia')
    await helper.wait(100)
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['prepend', 'afoo afoo afoo', 'abar abar'])
  })

  it('should work when change made to unrelated line', async () => {
    let doc = await setup()
    await doc.buffer.setLines(['prepend'], { start: 0, end: 0, strictIndexing: false })
    doc.forceSync()
    await helper.wait(200)
    let n = await rangeCount()
    expect(n).toBe(5)
    await nvim.call('cursor', [1, 1])
    await nvim.input('ia')
    await helper.wait(200)
    doc.forceSync()
    await helper.wait(100)
    await nvim.call('cursor', [2, 1])
    await nvim.input('a')
    await helper.wait(100)
    await doc.synchronize()
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['aprepend', 'afoo afoo afoo', 'abar abar'])
  })

  it('should add text before', async () => {
    let doc = await setup()
    await nvim.input('iabc')
    await helper.wait(30)
    await doc.synchronize()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['abcfoo abcfoo abcfoo', 'abcbar abcbar'])
  })

  it('should add text after', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 4])
    await nvim.input('iabc')
    await helper.wait(30)
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['fooabc fooabc fooabc', 'barabc barabc'])
  })

  it('should add text around', async () => {
    let doc = await setup()
    await nvim.setLine('"foo" foo foo')
    await helper.wait(30)
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['"foo" "foo" "foo"', '"bar" "bar"'])
  })

  it('should remove text before', async () => {
    let doc = await setup()
    await nvim.command('normal! x')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['oo oo oo', 'ar ar'])
  })

  it('should remove text middle', async () => {
    let doc = await setup()
    await nvim.call('cursor', [2, 2])
    await nvim.command('normal! x')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['fo fo fo', 'br br'])
  })

  it('should remove text after', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 3])
    await nvim.command('normal! x')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['fo fo fo', 'ba ba'])
  })

  it('should remove text around', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['"foo" "bar"']])
    await helper.wait(30)
    doc.forceSync()
    let ranges = [
      Range.create(0, 0, 0, 5),
      Range.create(0, 6, 0, 11)
    ]
    await cursors.addRanges(ranges)
    await nvim.call('cursor', [1, 2])
    await nvim.setLine('foo "bar"')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['foo bar'])
  })

  it('should replace text before', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 1])
    await nvim.command('normal! ra')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['aoo aoo aoo', 'aar aar'])
  })

  it('should replace text after', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 3])
    await nvim.command('normal! ra')
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['foa foa foa', 'baa baa'])
  })

  it('should replace text middle', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 2])
    await nvim.input('sab')
    await helper.wait(30)
    doc.forceSync()
    await helper.wait(100)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['fabo fabo fabo', 'babr babr'])
  })

  it('should adjust undo & redo on add & remove', async () => {
    let doc = await setup()
    await nvim.call('cursor', [1, 4])
    await nvim.input('iabc')
    await helper.wait(30)
    doc.forceSync()
    let n = await rangeCount()
    expect(n).toBe(5)
    await helper.wait(30)
    await nvim.command('undo')
    await helper.wait(30)
    doc.forceSync()
    n = await rangeCount()
    expect(n).toBe(5)
    await helper.wait(30)
    await nvim.command('redo')
    await helper.wait(30)
    doc.forceSync()
    expect(await rangeCount()).toBe(5)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['fooabc fooabc fooabc', 'barabc barabc'])
  })

  it('should adjust undo & redo on change around', async () => {
    let doc = await setup()
    await nvim.setLine('"foo" foo foo')
    await helper.wait(30)
    doc.forceSync()
    expect(await rangeCount()).toBe(5)
    await helper.wait(30)
    await nvim.command('undo')
    await helper.wait(30)
    doc.forceSync()
    expect(await rangeCount()).toBe(5)
    await helper.wait(30)
    await nvim.command('redo')
    await helper.wait(30)
    doc.forceSync()
    expect(await rangeCount()).toBe(5)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['"foo" "foo" "foo"', '"bar" "bar"'])
  })
})

describe('cursors#keymaps', () => {
  async function setup(): Promise<void> {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await helper.wait(30)
    doc.forceSync()
    await nvim.call('cursor', [1, 1])
    await cursors.select(doc.bufnr, 'position', 'n')
    await helper.wait(30)
    await nvim.call('cursor', [2, 1])
    await cursors.select(doc.bufnr, 'position', 'n')
    await helper.wait(30)
    await nvim.call('cursor', [3, 1])
    await cursors.select(doc.bufnr, 'position', 'n')
  }

  async function hasKeymap(key): Promise<boolean> {
    let buf = await nvim.buffer
    let keymaps = await buf.getKeymap('n') as any
    return keymaps.find(o => o.lhs == key) != null
  }

  it('should setup cancel keymap', async () => {
    await setup()
    let count = await rangeCount()
    expect(count).toBe(3)
    await nvim.input('<esc>')
    await helper.wait(100)
    count = await rangeCount()
    expect(count).toBe(0)
    let has = await hasKeymap('<Esc>')
    expect(has).toBe(false)
  })

  it('should setup next key', async () => {
    await setup()
    await nvim.input('<C-n>')
    await helper.wait(50)
    let cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([0, 0])
    await nvim.input('<C-n>')
    await helper.wait(50)
    cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([1, 0])
  })

  it('should setup previous key', async () => {
    await setup()
    await nvim.input('<C-p>')
    await helper.wait(50)
    let cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([1, 0])
    await nvim.input('<C-p>')
    await helper.wait(50)
    cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([0, 0])
  })
})
