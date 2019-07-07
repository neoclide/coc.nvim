import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import Cursors from '../../cursors'
import { Range } from 'vscode-languageserver-types'
import Document from '../../model/document'

let nvim: Neovim
let cursors: Cursors

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  cursors = new Cursors(nvim)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  nvim.pauseNotification()
  cursors.cancel()
  await nvim.resumeNotification()
  await helper.reset()
})

async function cursorCount(): Promise<number> {
  let matches = await nvim.call('getmatches')
  return matches.reduce((p, curr) => {
    if (curr.group == 'Cursor') {
      let len = Object.keys(curr).filter(k => k.startsWith('pos')).length
      p = p + len
    }
    return p
  }, 0)
}

async function rangeCount(): Promise<number> {
  let matches = await nvim.call('getmatches')
  return matches.reduce((p, curr) => {
    if (curr.group == 'CocCursorRange') {
      let len = Object.keys(curr).filter(k => k.startsWith('pos')).length
      p = p + len
    }
    return p
  }, 0)
}

describe('cursors#select', () => {

  it('should select by position', async () => {
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['a', 'b']])
    await nvim.call('cursor', [1, 1])
    await helper.wait(30)
    doc.forceSync()
    await cursors.select(doc.bufnr, 'position', 'n')
    let n = await cursorCount()
    expect(n).toBe(1)
    await nvim.setOption('virtualedit', 'onemore')
    await nvim.call('cursor', [2, 2])
    await cursors.select(doc.bufnr, 'position', 'n')
    n = await cursorCount()
    expect(n).toBe(2)
    await cursors.select(doc.bufnr, 'position', 'n')
    n = await cursorCount()
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
    await cursors.addRanges(doc, ranges)
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
    await cursors.addRanges(doc, ranges)
    await nvim.call('cursor', [1, 1])
    return doc
  }

  it('should add text before', async () => {
    await nvim.command('stopinsert')
    let doc = await setup()
    await nvim.input('iabc')
    await helper.wait(30)
    doc.forceSync()
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
    await nvim.call('cursor', [1, 2])
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
    await cursors.addRanges(doc, ranges)
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
})
