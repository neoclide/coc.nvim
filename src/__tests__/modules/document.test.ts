import { Neovim } from '@chemzqm/neovim'
import { Disposable, Range, Position } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
jest.setTimeout(30000)

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
    await helper.wait(200)
    let words = doc.words
    expect(words).toEqual(['foo', 'bar'])
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
    let doc = await helper.createDocument()
    await nvim.setLine('foo bar')
    await helper.wait(100)
    let range = doc.getWordRangeAtPosition({ line: 0, character: 0 })
    expect(range).toEqual(Range.create(0, 0, 0, 3))
    range = doc.getWordRangeAtPosition({ line: 0, character: 3 })
    expect(range).toBeNull()
    range = doc.getWordRangeAtPosition({ line: 0, character: 4 })
    expect(range).toEqual(Range.create(0, 4, 0, 7))
    range = doc.getWordRangeAtPosition({ line: 0, character: 7 })
    expect(range).toBeNull()
  })

  it('should get localify bonus', async () => {
    let doc = await helper.createDocument()
    let { buffer } = doc
    await buffer.setLines(['context content clearTimeout', ''],
      { start: 0, end: -1, strictIndexing: false })
    await helper.wait(100)
    let pos: Position = { line: 1, character: 0 }
    let res = doc.getLocalifyBonus(pos)
    expect(res.get('clearTimeout')).toBe(15)
    expect(res.get('content')).toBe(7)
    expect(res.get('context')).toBe(0)
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

  it('should be fast for localify bonus', async () => {
    let lines = []
    function randomWord(): string {
      let s = ''
      for (let i = 0; i < 10; i++) {
        s = s + String.fromCharCode(97 + Math.floor(Math.random() * 26))
      }
      return s
    }
    for (let i = 0; i < 300; i++) {
      let line = ''
      for (let i = 0; i < 10; i++) {
        line = line + randomWord() + ' '
      }
      lines.push(line)
    }
    let doc = await helper.createDocument('foo')
    let { buffer } = doc
    await buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false })
    await helper.wait(100)
    let ts = Date.now()
    doc.getLocalifyBonus({ line: 299, character: 0 })
    expect(Date.now() - ts).toBeLessThanOrEqual(100)
  })
})
