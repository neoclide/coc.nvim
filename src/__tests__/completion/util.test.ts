import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CompletionItem, CompletionItemKind, CompletionItemTag, Disposable, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { caseScore, matchScore, matchScoreWithPositions } from '../../completion/match'
import sources from '../../completion/sources'
import { CompleteOption, InsertMode, ISource } from '../../completion/types'
import { checkIgnoreRegexps, Converter, ConvertOption, createKindMap, emptLabelDetails, getDetail, getDocumentaions, getInput, getKindHighlight, getKindText, getPriority, getReplaceRange, getResumeInput, getWord, hasAction, highlightOffert, indentChanged, isWordCode, MruLoader, OptionForWord, Selection, shouldIndent, shouldStop, toCompleteDoneItem } from '../../completion/util'
import { WordDistance } from '../../completion/wordDistance'
import events from '../../events'
import languages from '../../languages'
import { Chars } from '../../model/chars'
import { disposeAll } from '../../util'
import { getCharCodes } from '../../util/fuzzy'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'
let disposables: Disposable[] = []

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(() => {
  disposeAll(disposables)
})

function getSource(): ISource {
  return sources.getSource('$words')
}

describe('util functions', () => {
  it('should toCompleteDoneItem', async () => {
    expect(toCompleteDoneItem(undefined, undefined)).toEqual({})
  })

  it('should getPriority', async () => {
    expect(getPriority(getSource(), 5)).toBe(5)
  })

  it('should add documentation', () => {
    let docs = getDocumentaions({ label: 'word', detail: 'detail' }, '')
    expect(docs).toEqual([{ filetype: 'txt', content: 'detail' }])
    docs = getDocumentaions({ label: 'word', documentation: { kind: 'plaintext', value: '' } }, '')
    expect(docs).toEqual([])
    docs = getDocumentaions({ label: 'word', detail: 'detail' }, '', true)
    expect(docs).toEqual([])
    docs = getDocumentaions({ label: 'word', detail: 'detail', documentation: { kind: 'markdown', value: 'markdown' } }, 'vim')
    expect(docs.length).toBe(2)
    docs = getDocumentaions({ word: '' }, '', true)
    expect(docs).toEqual([])
    docs = getDocumentaions({ word: '', documentation: [{ content: 'content', filetype: 'vim' }] }, '', true)
    expect(docs).toEqual([{ content: 'content', filetype: 'vim' }])
    docs = getDocumentaions({ word: '', info: 'info' }, '', true)
    expect(docs).toEqual([{ content: 'info', filetype: 'txt' }])
  })

  it('should get detail doc', () => {
    let item: CompletionItem = { label: '', detail: 'detail', labelDetails: {} }
    expect(getDetail(item, '')).toEqual({ filetype: 'txt', content: 'detail' })
    item = { label: '', detail: 'detail', labelDetails: { detail: 'detail', description: 'desc' } }
    expect(getDetail(item, '')).toEqual({ filetype: 'txt', content: 'detail desc' })
    item = { label: '', detail: 'detail', labelDetails: { description: 'desc' } }
    expect(getDetail(item, '')).toEqual({ filetype: 'txt', content: ' desc' })
    item = { label: '', detail: 'detail', labelDetails: { detail: 'detail' } }
    expect(getDetail(item, '')).toEqual({ filetype: 'txt', content: 'detail' })
    item = { label: '', detail: 'detail()' }
    expect(getDetail(item, 'vim')).toEqual({ filetype: 'vim', content: 'detail()' })
  })

  it('should get caseScore', () => {
    expect(typeof caseScore(10, 10, 2)).toBe('number')
  })

  it('should check action', async () => {
    expect(hasAction({ label: 'foo', additionalTextEdits: [] }, {})).toBe(false)
    expect(hasAction({ label: 'foo', insertTextFormat: InsertTextFormat.Snippet }, {})).toBe(true)
  })

  it('should check indentChanged', () => {
    expect(indentChanged(undefined, [1, 1, ''], '')).toBe(false)
    expect(indentChanged({ word: 'foo' }, [1, 4, 'foo'], '  foo')).toBe(true)
    expect(indentChanged({ word: 'foo' }, [1, 4, 'bar'], '  foo')).toBe(false)
  })

  it('should get highlight offset', () => {
    let n = highlightOffert(3, { abbr: 'abc', filterText: 'def' })
    expect(n).toBe(-1)
    expect(highlightOffert(3, { abbr: 'abc', filterText: 'abc' })).toBe(3)
    expect(highlightOffert(3, { abbr: 'xy abc', filterText: 'abc' })).toBe(6)
  })

  it('should getKindText', () => {
    expect(getKindText('t', new Map(), '')).toBe('t')
    let m = new Map()
    m.set(CompletionItemKind.Class, 'C')
    expect(getKindText(CompletionItemKind.Class, m, 'D')).toBe('C')
    expect(getKindText(CompletionItemKind.Class, new Map(), 'D')).toBe('D')
  })

  it('should getKindHighlight', async () => {
    const testHi = (kind: number | string, res: string) => {
      expect(getKindHighlight(kind)).toBe(res)
    }
    testHi(CompletionItemKind.Class, 'CocSymbolClass')
    testHi(999, 'CocSymbolDefault')
    testHi('', 'CocSymbolDefault')
  })

  it('should createKindMap', () => {
    let map = createKindMap({ constructor: 'C' })
    expect(map.get(CompletionItemKind.Constructor)).toBe('C')
    map = createKindMap({ constructor: undefined })
    expect(map.get(CompletionItemKind.Constructor)).toBe('')
  })

  it('should checkIgnoreRegexps', () => {
    expect(checkIgnoreRegexps([], '')).toBe(false)
    expect(checkIgnoreRegexps(['^^*^^'], 'input')).toBe(false)
    expect(checkIgnoreRegexps(['^inp', '^ind'], 'input')).toBe(true)
  })

  it('should getResumeInput', () => {
    let opt = { line: 'foo', colnr: 4, col: 1, position: { line: 0, character: 3 } }
    expect(getResumeInput(opt, '')).toBeNull()
    expect(getResumeInput(opt, 'f')).toBe('')
    expect(getResumeInput(opt, 'bar')).toBeNull()
    expect(getResumeInput(opt, 'foo f')).toBeNull()
    expect(getResumeInput(opt, 'foot')).toBe('oot')
  })

  function createOption(bufnr: number, linenr: number, line: string, col: number): Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'col'> {
    return { bufnr, linenr, line, col }
  }

  it('should check stop', () => {
    let opt = createOption(1, 1, 'a', 2)
    expect(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: '' }, opt)).toBe(true)
    expect(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: ' ' }, opt)).toBe(true)
    expect(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'fo' }, opt)).toBe(true)
    expect(shouldStop(2, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, { line: '', col: 2, lnum: 2, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'barb' }, opt)).toBe(true)
  })

  it('should check indent', () => {
    let res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'endfor')
    expect(res).toBe(true)
    res = shouldIndent('', 'endfor')
    expect(res).toBe(false)
    res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'foo bar')
    expect(res).toBe(false)
    res = shouldIndent('=~endif,=enddef,=endfu,=endfor', 'Endif')
    expect(res).toBe(true)
    res = shouldIndent(' ', '')
    expect(res).toBe(false)
    res = shouldIndent('*=endif', 'endif')
    expect(res).toBe(false)
    res = shouldIndent('0=foo', '  foo')
    expect(res).toBe(true)
  })

  it('should check isWordCode', () => {
    let chars = new Chars('@,_,#')
    expect(isWordCode(chars, 97, true)).toBe(true)
    expect(isWordCode(chars, 97, false)).toBe(true)
    expect(isWordCode(chars, 10, false)).toBe(false)
    expect(isWordCode(chars, 0xdc00, false)).toBe(false)
    expect(isWordCode(chars, 20320, true)).toBe(false)
  })

  it('should consider none word character as input', () => {
    let chars = new Chars('@,_,#')
    let res = getInput(chars, 'a#b#', false)
    expect(res).toBe('a#b#')
    res = getInput(chars, '你b#', true)
    expect(res).toBe('b#')
    res = getInput(chars, '你b#', false)
    expect(res).toBe('b#')
  })

  it('should check emptLabelDetails', () => {
    expect(emptLabelDetails(null)).toBe(true)
    expect(emptLabelDetails({})).toBe(true)
    expect(emptLabelDetails({ detail: '' })).toBe(true)
    expect(emptLabelDetails({ detail: 'detail' })).toBe(false)
    expect(emptLabelDetails({ description: 'detail' })).toBe(false)
  })

  it('should get word from complete item', () => {
    let item: CompletionItem = { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), '$foo\nbar') }
    let word = getWord(item, {})
    expect(word).toBe('$foo')
    item = { label: 'foo', data: { word: '$foo' } }
    word = getWord(item, {})
    expect(word).toBe('$foo')
    item = { label: 'foo', insertText: 'foo($1)' }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    expect(word).toBe('foo()')
    word = getWord(item, { insertTextFormat: InsertTextFormat.PlainText })
    expect(word).toBe('foo($1)')
    item = { label: 'foo' }
    word = getWord(item, {})
    expect(word).toBe('foo')
    item = { label: 'foo', insertText: 'foo' }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    expect(word).toBe('foo')
    item = { label: 'foo', insertText: 'foo($1)', kind: CompletionItemKind.Function }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    expect(word).toBe('foo')
  })

  it('should get replace range', () => {
    let item: CompletionItem = { label: 'foo' }
    expect(getReplaceRange(item, {})).toBeUndefined()
    expect(getReplaceRange(item, {}, 0)).toBeUndefined()
    expect(getReplaceRange(item, {
      editRange: Range.create(0, 0, 0, 3)
    }, 0)).toEqual(Range.create(0, 0, 0, 3))
    expect(getReplaceRange(item, {
      editRange: {
        insert: Range.create(0, 0, 0, 0),
        replace: Range.create(0, 0, 0, 3),
      }
    }, 0)).toEqual(Range.create(0, 0, 0, 3))
    expect(getReplaceRange(item, {
      editRange: {
        insert: Range.create(0, 0, 0, 0),
        replace: Range.create(0, 0, 0, 3),
      }
    }, 0, InsertMode.Insert)).toEqual(Range.create(0, 0, 0, 0))
    item.textEdit = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')
    expect(getReplaceRange(item, {}, 0)).toEqual(Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
    expect(getReplaceRange(item, {}, 0)).toEqual(Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 1, 0, 0),
      replace: Range.create(0, 1, 0, 3),
    }
    expect(getReplaceRange(item, {}, 0)).toEqual(Range.create(0, 0, 0, 3))
  })

  describe('Converter', () => {
    function create(inputStart: number, option: ConvertOption, opt: OptionForWord): Converter {
      return new Converter(inputStart, option, opt)
    }

    it('should get previous & after', () => {
      let opt = {
        line: '$foo',
        col: 1,
        position: Position.create(0, 1)
      }
      let option: ConvertOption = {
        insertMode: InsertMode.Repalce,
        priority: 0,
        range: Range.create(0, 1, 0, 4),
        source: getSource(),
      }
      let c = create(1, option, opt)
      expect(c.getPrevious(0)).toBe('$')
      expect(c.getPrevious(0)).toBe('$')
      expect(c.getAfter(4)).toBe('foo')
      expect(c.getAfter(4)).toBe('foo')
      expect(c.getAfter(2)).toBe('f')
    })

    it('should convert completion item', () => {
      let opt = {
        line: '',
        position: Position.create(0, 0)
      }
      let option: ConvertOption = {
        insertMode: InsertMode.Repalce,
        range: Range.create(0, 0, 0, 0),
        priority: 0,
        source: getSource(),
      }
      let item: any = {
        label: 'f',
        insertText: 'f',
        score: 3,
        data: { optional: true, dup: 0 },
        tags: [CompletionItemTag.Deprecated]
      }
      let c = create(0, option, opt)
      let res = c.convertToDurationItem(item)
      expect(res.abbr.endsWith('?')).toBe(true)
      expect(typeof res.sortText).toBe('string')
      expect(res.deprecated).toBe(true)
      expect(res.dup).toBe(false)
    })

    it('should replace word after cursor', () => {
      let opt = {
        line: 'afoo',
        position: Position.create(0, 1)
      }
      let option: ConvertOption = {
        insertMode: InsertMode.Repalce,
        range: Range.create(0, 1, 0, 1),
        priority: 0,
        source: getSource(),
      }
      let item: CompletionItem = {
        label: 'afoo',
        insertText: 'afoo',
        textEdit: TextEdit.replace(Range.create(0, 0, 0, 4), 'afoo'),
      }
      let c = create(1, option, opt)
      let res = c.convertToDurationItem(item)
      expect(res.character).toBe(0)
      expect(res.word).toBe('a')
      item.textEdit = TextEdit.replace(Range.create(0, 1, 0, 4), 'foo')
      item.labelDetails = { description: 'description' }
      res = c.convertToDurationItem(item)
      expect(res.character).toBe(1)
      expect(res.labelDetails).toBeDefined()
    })

    it('should convert completion item', () => {
      let opt = {
        line: '@',
        position: Position.create(0, 1)
      }
      let option: ConvertOption = {
        range: Range.create(0, 0, 0, 1),
        insertMode: InsertMode.Repalce,
        priority: 0,
        asciiMatch: false,
        source: getSource(),
      }
      let item: any = {
        word: '@foo',
        abbr: 'foo'
      }
      let c = create(1, option, opt)
      let res = c.convertToDurationItem(item)
      expect(res.filterText).toBe('@foo')
      expect(res.delta).toBe(1)
    })
  })

  describe('matchScore', () => {
    function score(word: string, input: string): number {
      return matchScore(word, getCharCodes(input))
    }

    it('should match score for last letter', () => {
      expect(score('#!3', '3')).toBe(1)
      expect(score('bar', 'f')).toBe(0)
    })

    it('should return 0 when not matched', () => {
      expect(score('and', '你')).toBe(0)
      expect(score('你and', '你的')).toBe(0)
      expect(score('fooBar', 'Bt')).toBe(0)
      expect(score('thisbar', 'tihc')).toBe(0)
    })

    it('should match first letter', () => {
      expect(score('abc', '')).toBe(0)
      expect(score('abc', 'a')).toBe(5)
      expect(score('Abc', 'a')).toBe(2.5)
      expect(score('__abc', 'a')).toBe(2)
      expect(score('$Abc', 'a')).toBe(1)
      expect(score('$Abc', 'A')).toBe(2)
      expect(score('$Abc', '$A')).toBe(6)
      expect(score('$Abc', '$a')).toBe(5.5)
      expect(score('foo_bar', 'b')).toBe(2)
      expect(score('foo_Bar', 'b')).toBe(1)
      expect(score('_foo_Bar', 'b')).toBe(0.5)
      expect(score('_foo_Bar', 'f')).toBe(2)
      expect(score('bar', 'a')).toBe(1)
      expect(score('fooBar', 'B')).toBe(2)
      expect(score('fooBar', 'b')).toBe(1)
      expect(score('fobtoBar', 'bt')).toBe(2)
    })

    it('should match follow letters', () => {
      expect(score('abc', 'ab')).toBe(6)
      expect(score('adB', 'ab')).toBe(5.75)
      expect(score('adb', 'ab')).toBe(5.1)
      expect(score('adCB', 'ab')).toBe(5.05)
      expect(score('a_b_c', 'ab')).toBe(6)
      expect(score('FooBar', 'fb')).toBe(3.25)
      expect(score('FBar', 'fb')).toBe(3)
      expect(score('FooBar', 'FB')).toBe(6)
      expect(score('FBar', 'FB')).toBe(6)
      expect(score('a__b', 'a__b')).toBe(8)
      expect(score('aBc', 'ab')).toBe(5.5)
      expect(score('a_B_c', 'ab')).toBe(5.75)
      expect(score('abc', 'abc')).toBe(7)
      expect(score('abc', 'aC')).toBe(0)
      expect(score('abc', 'ac')).toBe(5.1)
      expect(score('abC', 'ac')).toBe(5.75)
      expect(score('abC', 'aC')).toBe(6)
    })

    it('should only allow search once', () => {
      expect(score('foobar', 'fbr')).toBe(5.2)
      expect(score('foobaRow', 'fbr')).toBe(5.85)
      expect(score('foobaRow', 'fbR')).toBe(6.1)
      expect(score('foobar', 'fa')).toBe(5.1)
    })

    it('should have higher score for strict match', () => {
      expect(score('language-client-protocol', 'lct')).toBe(6.1)
      expect(score('language-client-types', 'lct')).toBe(7)
    })

    it('should find highest score', () => {
      expect(score('ArrayRotateTail', 'art')).toBe(3.6)
    })
  })

  describe('matchScoreWithPositions', () => {
    function assertMatch(word: string, input: string, res: [number, ReadonlyArray<number>] | undefined): void {
      let result = matchScoreWithPositions(word, getCharCodes(input))
      if (!res) {
        expect(result).toBeUndefined()
      } else {
        expect(result).toEqual(res)
      }
    }

    it('should return undefined when not match found', () => {
      assertMatch('a', 'abc', undefined)
      assertMatch('a', '', undefined)
      assertMatch('ab', 'ac', undefined)
    })

    it('should find matches by position fix', () => {
      assertMatch('this', 'tih', [5.6, [0, 1, 2]])
      assertMatch('globalThis', 'tihs', [2.6, [6, 7, 8, 9]])
    })

    it('should find matched positions', () => {
      assertMatch('this', 'th', [6, [0, 1]])
      assertMatch('foo_bar', 'fb', [6, [0, 4]])
      assertMatch('assertMatch', 'am', [5.75, [0, 6]])
    })
  })

  describe('wordDistance', () => {
    it('should empty when not enabled', async () => {
      let w = await WordDistance.create(false, {} as any, CancellationToken.None)
      expect(w.distance(Position.create(0, 0), {} as any)).toBe(0)
    })

    it('should empty when selectRanges is empty', async () => {
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      expect(w).toBe(WordDistance.None)
    })

    it('should empty when timeout', async () => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 0, 1)
          }]
        }
      }))
      let spy = jest.spyOn(workspace, 'computeWordRanges').mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(null)
          }, 50)
        })
      })
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      spy.mockRestore()
      expect(w).toBe(WordDistance.None)
    })

    it('should get distance', async () => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 1, 0),
            parent: {
              range: Range.create(0, 0, 3, 0)
            }
          }]
        }
      }))
      let filepath = await createTmpFile('foo bar\ndef', disposables)
      await helper.edit(filepath)
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      expect(w.distance(Position.create(1, 0), {} as any)).toBeGreaterThan(0)
      expect(w.distance(Position.create(0, 0), { word: '', kind: CompletionItemKind.Keyword } as any)).toBeGreaterThan(0)
      expect(w.distance(Position.create(0, 0), { word: 'not_exists' } as any)).toBeGreaterThan(0)
      expect(w.distance(Position.create(0, 0), { word: 'bar' } as any)).toBe(0)
      expect(w.distance(Position.create(0, 0), { word: 'def' } as any)).toBeGreaterThan(0)
      await nvim.call('cursor', [1, 2])
      await events.fire('CursorMoved', [opt.bufnr, [1, 2]])
      expect(w.distance(Position.create(0, 0), { word: 'bar' } as any)).toBe(0)
    })

    it('should get same range', async () => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 1, 0),
            parent: {
              range: Range.create(0, 0, 3, 0)
            }
          }]
        }
      }))
      let spy = jest.spyOn(workspace, 'computeWordRanges').mockImplementation(() => {
        return Promise.resolve({ foo: [Range.create(0, 0, 0, 0)] })
      })
      let opt = await nvim.call('coc#util#get_complete_option') as any
      opt.word = ''
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      spy.mockRestore()
      let res = w.distance(Position.create(0, 0), { word: 'foo' } as any)
      expect(res).toBe(0)
    })
  })

  describe('MruLoader', () => {
    it('should add item without prefix', () => {
      let loader = new MruLoader()
      loader.add('foo', { kind: '', source: getSource(), filterText: 'foo' })
      let item = { kind: CompletionItemKind.Class, source: getSource(), filterText: '$foo' }
      loader.add('foo', item)
      let score = loader.getScore('', item, Selection.RecentlyUsed)
      expect(score).toBeGreaterThan(-1)
      score = loader.getScore('a', item, Selection.RecentlyUsedByPrefix)
      expect(score).toBe(-1)
      score = loader.getScore('f', item, Selection.RecentlyUsed)
      expect(score).toBeGreaterThan(-1)
    })
  })
})
