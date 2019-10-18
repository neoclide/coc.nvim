import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
jest.setTimeout(5000)

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

describe('document model properties', () => {
  it('should parse iskeyword', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('foo bar')
    doc.forceSync()
    let words = doc.words
    expect(words).toEqual(['foo', 'bar'])
  })

  it('should applyEdits', async () => {
    let doc = await helper.createDocument()
    let edits: TextEdit[] = []
    edits.push({
      range: Range.create(0, 0, 0, 0),
      newText: 'a\n'
    })
    edits.push({
      range: Range.create(0, 0, 0, 0),
      newText: 'b\n'
    })
    await doc.applyEdits(nvim, edits)
    let content = doc.getDocumentContent()
    expect(content).toBe('a\nb\n\n')
  })

  it('should parse iskeyword of character range', async () => {
    await nvim.setOption('iskeyword', 'a-z,A-Z,48-57,_')
    let doc = await helper.createDocument()
    let opt = await nvim.getOption('iskeyword')
    expect(opt).toBe('a-z,A-Z,48-57,_')
    await nvim.setLine('foo bar')
    doc.forceSync()
    await helper.wait(100)
    let words = doc.words
    expect(words).toEqual(['foo', 'bar'])
  })

  it('should get word range', async () => {
    await helper.createDocument()
    await nvim.setLine('foo bar')
    await helper.wait(30)
    let doc = await workspace.document
    let range = doc.getWordRangeAtPosition({ line: 0, character: 0 })
    expect(range).toEqual(Range.create(0, 0, 0, 3))
    range = doc.getWordRangeAtPosition({ line: 0, character: 3 })
    expect(range).toBeNull()
    range = doc.getWordRangeAtPosition({ line: 0, character: 4 })
    expect(range).toEqual(Range.create(0, 4, 0, 7))
    range = doc.getWordRangeAtPosition({ line: 0, character: 7 })
    expect(range).toBeNull()
  })

  it('should get symbol ranges', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('foo bar foo')
    let ranges = doc.getSymbolRanges('foo')
    expect(ranges.length).toBe(2)
  })

  it('should get localify bonus', async () => {
    let doc = await helper.createDocument()
    let { buffer } = doc
    await buffer.setLines(['context content clearTimeout', '', 'product confirm'],
      { start: 0, end: -1, strictIndexing: false })
    await helper.wait(100)
    let pos: Position = { line: 1, character: 0 }
    let res = doc.getLocalifyBonus(pos, pos)
    expect(res.has('confirm')).toBe(true)
    expect(res.has('clearTimeout')).toBe(true)
  })

  it('should get current line', async () => {
    let doc = await helper.createDocument()
    let { buffer } = doc
    await buffer.setLines(['first line', 'second line'],
      { start: 0, end: -1, strictIndexing: false })
    await helper.wait(30)
    let line = doc.getline(1, true)
    expect(line).toBe('second line')
  })

  it('should get cached line', async () => {
    let doc = await helper.createDocument()
    let { buffer } = doc
    await buffer.setLines(['first line', 'second line'],
      { start: 0, end: -1, strictIndexing: false })
    await helper.wait(30)
    doc.forceSync()
    let line = doc.getline(0, false)
    expect(line).toBe('first line')
  })

  it('should add matches to ranges', async () => {
    let doc = await helper.createDocument()
    let buf = doc.buffer
    let lines = [
      'a'.repeat(30),
      'b'.repeat(30),
      'c'.repeat(30),
      'd'.repeat(30)
    ]
    await buf.setLines(lines, { start: 0, end: -1 })
    await helper.wait(100)
    let ranges: Range[] = [
      Range.create(0, 0, 0, 10),
      Range.create(1, 0, 2, 10),
      Range.create(3, 0, 4, 0)]
    nvim.pauseNotification()
    doc.matchAddRanges(ranges, 'Search')
    await nvim.resumeNotification()
    let res = await nvim.call('getmatches')
    let item = res.find(o => o.group == 'Search')
    expect(item).toBeDefined()
    expect(item.pos1).toEqual([1, 1, 10])
    expect(item.pos2).toEqual([2, 1, 30])
    expect(item.pos3).toEqual([3, 1, 10])
    expect(item.pos4).toEqual([4, 1, 30])
  })

  it('should get variable form buffer', async () => {
    await nvim.command('autocmd BufNewFile,BufRead * let b:coc_enabled = 1')
    let doc = await helper.createDocument()
    let val = doc.getVar<number>('enabled')
    expect(val).toBe(1)
  })

  it('should attach change events', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('abc')
    await helper.wait(50)
    let content = doc.getDocumentContent()
    expect(content.indexOf('abc')).toBe(0)
  })

  it('should not attach change events when b:coc_enabled is false', async () => {
    await nvim.command('autocmd BufNewFile,BufRead *.dis let b:coc_enabled = 0')
    let doc = await helper.createDocument('a.dis')
    let val = doc.getVar<number>('enabled', 0)
    expect(val).toBe(0)
    await nvim.setLine('abc')
    await helper.wait(50)
    let content = doc.getDocumentContent()
    expect(content.indexOf('abc')).toBe(-1)
  })
})
