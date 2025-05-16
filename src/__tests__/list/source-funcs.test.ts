import { Neovim } from '@chemzqm/neovim'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { DocumentSymbol, Location, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import which from 'which'
import BasicList, { toVimFiletype } from '../../list/basic'
import { fixWidth, formatListItems, formatPath, formatUri, UnformattedListItem } from '../../list/formatting'
import { getExtensionPrefix, getExtensionPriority, sortExtensionItem } from '../../list/source/extensions'
import { mruScore } from '../../list/source/lists'
import { contentToItems, getFilterText, loadCtagsSymbols, symbolsToListItems } from '../../list/source/outline'
import { sortSymbolItems, toTargetLocation } from '../../list/source/symbols'
import { ListItem } from '../../list/types'
import { os, path } from '../../util/node'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

class SimpleList extends BasicList {
  public name = 'simple'
  public defaultAction: 'preview'
  constructor() {
    super()
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve([])
  }
}

describe('List util', () => {
  it('should get list score', () => {
    expect(mruScore(['foo'], 'foo')).toBe(1)
    expect(mruScore([], 'foo')).toBe(-1)
  })
})

describe('BasicList util', () => {
  let list: SimpleList
  beforeAll(() => {
    list = new SimpleList()
  })

  it('should get filetype', async () => {
    expect(toVimFiletype('latex')).toBe('tex')
    expect(toVimFiletype('foo')).toBe('foo')
  })

  it('should convert uri', async () => {
    let uri = URI.file(__filename).toString()
    let res = await list.convertLocation(uri)
    expect(res.uri).toBe(uri)
  })

  it('should convert location with line', async () => {
    let uri = URI.file(__filename).toString()
    let res = await list.convertLocation({ uri, line: 'convertLocation()', text: 'convertLocation' })
    expect(res.uri).toBe(uri)
    res = await list.convertLocation({ uri, line: 'convertLocation()' })
    expect(res.uri).toBe(uri)
  })

  it('should convert location with custom schema', async () => {
    let uri = 'test:///foo'
    let res = await list.convertLocation({ uri, line: 'convertLocation()' })
    expect(res.uri).toBe(uri)
  })
})

describe('Outline util', () => {
  it('should getFilterText', () => {
    expect(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), 'kind')).toBe('name')
    expect(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), '')).toBe('nameFunction')
  })

  it('should load items by ctags', async () => {
    let doc = await workspace.document
    let spy = jest.spyOn(which, 'sync').mockImplementation(() => {
      return ''
    })
    let items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    expect(items).toEqual([])
    spy.mockRestore()
    doc = await helper.createDocument(__filename)
    items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    expect(Array.isArray(items)).toBe(true)
  })

  it('should convert symbols to list items', async () => {
    let symbols: DocumentSymbol[] = []
    symbols.push(DocumentSymbol.create('function', '', SymbolKind.Function, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1)))
    symbols.push(DocumentSymbol.create('class', '', SymbolKind.Class, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)))
    let items = symbolsToListItems(symbols, 'lsp:/1', 'class')
    expect(items.length).toBe(1)
    expect(items[0].data.kind).toBe('Class')
  })

  it('should convert to list items', async () => {
    let doc = await workspace.document
    expect(contentToItems('a\tb\t2\td\n\n', doc).length).toBe(1)
  })
})

describe('Extensions util', () => {
  it('should sortExtensionItem', () => {
    expect(sortExtensionItem({ data: { priority: 1 } }, { data: { priority: 0 } })).toBe(-1)
    expect(sortExtensionItem({ data: { id: 'a' } }, { data: { id: 'b' } })).toBe(1)
    expect(sortExtensionItem({ data: { id: 'b' } }, { data: { id: 'a' } })).toBe(-1)
  })

  it('should get extension prefix', () => {
    expect(getExtensionPrefix('')).toBe('+')
    expect(getExtensionPrefix('disabled')).toBe('-')
    expect(getExtensionPrefix('activated')).toBe('*')
    expect(getExtensionPrefix('unknown')).toBe('?')
  })

  it('should get extension priority', () => {
    expect(getExtensionPriority('')).toBe(0)
    expect(getExtensionPriority('unknown')).toBe(2)
    expect(getExtensionPriority('activated')).toBe(1)
    expect(getExtensionPriority('disabled')).toBe(-1)
  })
})

describe('Symbols util', () => {
  it('should convert to location', () => {
    let res = toTargetLocation({ uri: 'untitled:1' })
    expect(Location.is(res)).toBe(true)
  })
})

describe('formatting', () => {
  it('should format path', () => {
    let base = path.basename(__filename)
    expect(formatPath('short', 'home')).toMatch('home')
    expect(formatPath('hidden', 'path')).toBe('')
    expect(formatPath('full', __filename)).toMatch(base)
    expect(formatPath('short', __filename)).toMatch(base)
    expect(formatPath('filename', __filename)).toMatch(base)
  })

  it('should format uri', () => {
    let cwd = process.cwd()
    expect(formatUri('http://www.example.com', cwd)).toMatch('http')
    expect(formatUri(URI.file(__filename).toString(), cwd)).toMatch('source')
    expect(formatUri(URI.file(os.tmpdir()).toString(), cwd)).toMatch(os.tmpdir())
  })

  it('should fixWidth', () => {
    expect(fixWidth('a'.repeat(10), 2)).toBe('a.')
  })

  it('should sort symbols', () => {
    const assert = (a, b, n) => {
      expect(sortSymbolItems(a, b)).toBe(n)
    }
    assert({ data: { score: 1 } }, { data: { score: 2 } }, 1)
    assert({ data: { kind: 1 } }, { data: { kind: 2 } }, -1)
    assert({ data: { file: 'aa' } }, { data: { file: 'b' } }, 1)
  })

  it('should format list items', () => {
    expect(formatListItems(false, [])).toEqual([])
    let items: UnformattedListItem[] = [{
      label: ['a', 'b', 'c']
    }]
    expect(formatListItems(false, items)).toEqual([{
      label: 'a\tb\tc'
    }])
    items = [{
      label: ['a', 'b', 'c']
    }, {
      label: ['foo', 'bar', 'go']
    }]
    expect(formatListItems(true, items)).toEqual([{
      label: 'a  \tb  \tc '
    }, {
      label: 'foo\tbar\tgo'
    }])
  })
})

