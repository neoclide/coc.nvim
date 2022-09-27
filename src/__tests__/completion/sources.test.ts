import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import sources from '../../sources/index'
import { matchLine } from '../../sources/keywords'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

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

describe('utils', () => {
  it('should matchLine', async () => {
    let doc = await workspace.document
    let text = 'a'.repeat(2048)
    expect(matchLine(text, doc.chars)).toEqual(['a'.repeat(1024)])
    expect(matchLine('a b c', doc.chars)).toEqual([])
    expect(matchLine('foo bar', doc.chars)).toEqual(['foo', 'bar'])
    expect(matchLine('?foo bar', doc.chars)).toEqual(['foo', 'bar'])
    expect(matchLine('?foo $', doc.chars)).toEqual(['foo'])
    expect(matchLine('?foo foo foo', doc.chars)).toEqual(['foo'])
  })
})

describe('KeywordsBuffer', () => {
  it('should parse keywords', async () => {
    let filepath = await createTmpFile(' ab')
    let doc = await helper.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    let words = b.getWords()
    expect(words).toEqual(['ab'])
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
    words = b.getWords()
    expect(words).toEqual(['foo', 'bar', 'ab'])
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 1, 3), 'def ')])
    words = b.getWords()
    expect(words).toEqual(['def', 'ab'])
  })

  it('should fuzzy for matchKeywords', async () => {
    let filepath = await createTmpFile(`_foo\nbar\n`)
    let doc = await helper.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    const getResults = (iterable: Iterable<string>) => {
      let res: string[] = []
      for (let word of iterable) {
        res.push(word)
      }
      return res
    }
    let iterable = b.matchWords(0, 'br', true)
    expect(getResults(iterable)).toEqual(['bar'])
    iterable = b.matchWords(0, 'f', true)
    expect(getResults(iterable)).toEqual(['_foo'])
    iterable = b.matchWords(0, '_', true)
    expect(getResults(iterable)).toEqual(['_foo'])
  })

  it('should match by unicode', async () => {
    let filepath = await createTmpFile(`aéà\nàçé\n`)
    let doc = await helper.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    const getResults = (iterable: Iterable<string>) => {
      let res: string[] = []
      for (let word of iterable) {
        res.push(word)
      }
      return res
    }
    let iterable = b.matchWords(0, 'ae', true)
    expect(getResults(iterable)).toEqual([
      'aéà', 'àçé'
    ])
  })
})

describe('native sources', () => {
  it('should works for around source', async () => {
    let doc = await workspace.document
    await nvim.setLine('foo ')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('Af')
    await helper.waitPopup()
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<esc>')
  })

  it('should works for buffer source', async () => {
    await helper.createDocument()
    await nvim.command('set hidden')
    let doc = await helper.createDocument()
    await nvim.setLine('other')
    await nvim.command('bp')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('io')
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should works with file source', async () => {
    await helper.edit()
    await nvim.input('i/')
    await helper.waitPopup()
  })
})
