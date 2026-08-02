import { Neovim } from '../../neovim'
import { CancellationToken, CompletionItem, CompletionItemKind, CompletionItemTag, Disposable, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import Complete, { selectTopItems, sortItems } from '../../completion/complete'
import { caseScore, matchScore, matchScoreWithPositions } from '../../completion/match'
import sources from '../../completion/sources'
import { CompleteConfig, CompleteOption, DurationCompleteItem, InsertMode, ISource, SortMethod } from '../../completion/types'
import { checkIgnoreRegexps, Converter, ConvertOption, createKindMap, deltaCount, emptLabelDetails, getDetail, getDocumentations, getInput, getKindHighlight, getKindText, getPriority, getReplaceRange, getResumeInput, getWord, hasAction, highlightOffset, indentChanged, isWordCode, MruLoader, OptionForWord, Selection, shouldIndent, shouldStop, toCompleteDoneItem } from '../../completion/util'
import { WordDistance } from '../../completion/wordDistance'
import events, { InsertChange } from '../../events'
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
    let docs = getDocumentations({ label: 'word', detail: 'detail' }, '')
    expect(docs).toEqual([{ filetype: 'txt', content: 'detail' }])
    docs = getDocumentations({ label: 'word', documentation: { kind: 'plaintext', value: '' } }, '')
    expect(docs).toEqual([])
    docs = getDocumentations({ label: 'word', detail: 'detail' }, '', true)
    expect(docs).toEqual([])
    docs = getDocumentations({ label: 'word', detail: 'detail', documentation: { kind: 'markdown', value: 'markdown' } }, 'vim')
    expect(docs.length).toBe(2)
    docs = getDocumentations({ word: '' }, '', true)
    expect(docs).toEqual([])
    docs = getDocumentations({ word: '', documentation: [{ content: 'content', filetype: 'vim' }] }, '', true)
    expect(docs).toEqual([{ content: 'content', filetype: 'vim' }])
    docs = getDocumentations({ word: '', info: 'info' }, '', true)
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

  it('should get deltaCount', () => {
    let base = { lnum: 1, col: 1, line: '', changedtick: 1, pre: '' }
    let insert: InsertChange = Object.assign({ insertChar: 's' }, base)
    expect(deltaCount(insert)).toBe(0)
    insert = Object.assign({ insertChar: 's', insertChars: ['s'] }, base)
    expect(deltaCount(insert)).toBe(0)
    insert = Object.assign({ insertChar: 's', insertChars: ['s', 's'] }, base, { pre: 's' })
    expect(deltaCount(insert)).toBe(0)
    insert = Object.assign({ insertChar: '<', insertChars: ['<', '>'] }, base, { pre: '<', line: '<x' })
    expect(deltaCount(insert)).toBe(0)
    insert = Object.assign({ insertChar: '<', insertChars: ['<', '>'] }, base, { pre: '<', line: '<>' })
    expect(deltaCount(insert)).toBe(1)
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
    let n = highlightOffset(3, { abbr: 'abc', filterText: 'def' })
    expect(n).toBe(-1)
    expect(highlightOffset(3, { abbr: 'abc', filterText: 'abc' })).toBe(3)
    expect(highlightOffset(3, { abbr: 'xy abc', filterText: 'abc' })).toBe(6)
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
    expect(getReplaceRange(item, undefined)).toBeUndefined()
    expect(getReplaceRange(item, undefined, 0)).toBeUndefined()
    expect(getReplaceRange(item, Range.create(0, 0, 0, 3), 0)).toEqual(Range.create(0, 0, 0, 3))
    expect(getReplaceRange(item, {
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
      , 0)).toEqual(Range.create(0, 0, 0, 3))
    expect(getReplaceRange(item, {
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
      , 0, InsertMode.Insert)).toEqual(Range.create(0, 0, 0, 0))
    item.textEdit = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')
    expect(getReplaceRange(item, undefined, 0)).toEqual(Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
    expect(getReplaceRange(item, undefined, 0)).toEqual(Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 1, 0, 0),
      replace: Range.create(0, 1, 0, 3),
    }
    expect(getReplaceRange(item, undefined, 0)).toEqual(Range.create(0, 0, 0, 3))
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
        insertMode: InsertMode.Replace,
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
        insertMode: InsertMode.Replace,
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
        insertMode: InsertMode.Replace,
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
        insertMode: InsertMode.Replace,
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
      let spy = vi.spyOn(workspace, 'computeWordRanges').mockImplementation(() => {
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
      let spy = vi.spyOn(workspace, 'computeWordRanges').mockImplementation(() => {
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

  describe('sortItems', () => {
    it('should sort items', () => {
      let emptyInput = false
      let defaultSortMethod: SortMethod = SortMethod.None
      let a: any = {
        abbr: 'a', character: 0, filterText: 'a', index: 0, source: '', word: 'a'
      }
      let b: any = {
        abbr: 'b', character: 0, filterText: 'b', index: 0, source: '', word: 'b'
      }
      const check = (ap: any, bp: any, res: number) => {
        let val = sortItems(emptyInput, defaultSortMethod, Object.assign(ap, a), Object.assign(bp, b))
        expect(val).toBe(res)
      }
      check({ score: 1 }, { score: 2 }, 1)
      check({ priority: 1 }, { priority: 2 }, 1)
      check({ sortText: 'b' }, { sortText: 'a' }, 1)
      check({ sortText: 'a' }, { sortText: 'b' }, -1)
      check({ localBonus: 1 }, { localBonus: 2 }, 1)
    })
  })

  describe('selectTopItems', () => {
    it('should return empty for non-positive count', () => {
      expect(selectTopItems([3, 1, 2], 0, (a, b) => a - b)).toEqual([])
    })

    it('should sort when array is not larger than count', () => {
      let items = selectTopItems([3, 1, 2], 5, (a, b) => a - b)
      expect(items).toEqual([1, 2, 3])
    })

    it('should keep only the best items in order', () => {
      let items = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
      let top = selectTopItems(items, 3, (a, b) => a - b)
      expect(top).toEqual([1, 2, 3])
      // original array untouched except when it fits entirely
      expect(items).toEqual([10, 1, 9, 2, 8, 3, 7, 4, 6, 5])
    })

    it('should match full sort result for random data', () => {
      let values: number[] = []
      for (let i = 0; i < 500; i++) values.push(Math.floor(Math.random() * 1000))
      let count = 50
      let expected = values.slice().sort((a, b) => a - b).slice(0, count)
      expect(selectTopItems(values, count, (a, b) => a - b)).toEqual(expected)
    })

    it('should keep stable result with equal items', () => {
      let values = [5, 1, 5, 3, 5, 2]
      expect(selectTopItems(values, 4, (a, b) => a - b)).toEqual([1, 2, 3, 5])
    })
  })

  describe('filterItems', () => {
    function makeItem(word: string, opts?: Partial<DurationCompleteItem>): DurationCompleteItem {
      return Object.assign({
        abbr: word,
        word,
        filterText: word,
        score: 0,
        priority: 0,
        sortText: word,
        source: getSource(),
        character: 1,
        delta: 0,
      }, opts)
    }

    function createComplete(items: DurationCompleteItem[], config?: Partial<CompleteConfig>): Complete {
      let option = {
        position: Position.create(0, 0),
        bufnr: 1,
        line: 'rlut ',
        col: 5,
        input: 'rlut',
        filetype: '',
        filepath: '',
        word: 'rlut',
        followWord: '',
        colnr: 5,
        linenr: 1,
        changedtick: 0,
      } as CompleteOption
      let completeConfig: CompleteConfig = Object.assign({
        autoTrigger: 'always',
        insertMode: InsertMode.Replace,
        filterGraceful: true,
        enableFloat: true,
        languageSourcePriority: 99,
        snippetsSupport: true,
        defaultSortMethod: SortMethod.Length,
        removeDuplicateItems: false,
        removeCurrentWord: false,
        acceptSuggestionOnCommitCharacter: false,
        triggerCompletionWait: 0,
        triggerAfterInsertEnter: false,
        maxItemCount: 256,
        timeout: 500,
        minTriggerInputLength: 1,
        localityBonus: true,
        highPrioritySourceLimit: null,
        lowPrioritySourceLimit: null,
        ignoreRegexps: [],
        asciiMatch: true,
        asciiCharactersOnly: false,
      }, config)
      let complete = new Complete(option, {} as any, completeConfig, [{ name: 'test' }] as any)
      ;(complete as any).results.set('test', { items, isIncomplete: false })
      return complete
    }

    function fill(count: number, word = 'word'): DurationCompleteItem[] {
      let items: DurationCompleteItem[] = []
      for (let i = 0; i < count; i++) items.push(makeItem(`${word}_${i}`))
      return items
    }

    it('should use aggressive scorer for small sets', () => {
      let items = fill(10)
      items.push(makeItem('console'))
      let complete = createComplete(items)
      let filtered = complete.filterItems('cno')
      let item = filtered.find(o => o.word == 'console')
      expect(item).toBeDefined()
      // aggressive: ^c^o^nsole
      expect(item.positions.slice(2)).toEqual([2, 1, 0])
    })

    it('should use graceful scorer for medium sets', () => {
      let items = fill(301)
      items.push(makeItem('console'))
      let complete = createComplete(items)
      let filtered = complete.filterItems('cno')
      let item = filtered.find(o => o.word == 'console')
      expect(item).toBeDefined()
      // graceful: ^co^ns^ole
      expect(item.positions.slice(2)).toEqual([4, 2, 0])
    })

    it('should use plain scorer for large sets', () => {
      let items = fill(2001)
      items.push(makeItem('result'))
      let complete = createComplete(items)
      // 'rlut' only matches 'result' through graceful permutations
      expect(complete.filterItems('rlut').find(o => o.word == 'result')).toBeUndefined()
    })

    it('should use plain scorer when graceful is disabled', () => {
      let items = fill(10)
      items.push(makeItem('result'))
      let complete = createComplete(items, { filterGraceful: false })
      expect(complete.filterItems('rlut').find(o => o.word == 'result')).toBeUndefined()
    })

    it('should score with delta input using precomputed text', () => {
      let items = [makeItem('foobar', { delta: 3, character: 1 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('bar')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].word).toBe('foobar')
      expect(filtered[0].score).toBeGreaterThan(0)
    })

    it('should score trigger text when input is empty', () => {
      let items = [makeItem('foobar', { character: 1 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].positions).toBeDefined()
    })

    it('should not match items at cursor when input is empty', () => {
      // character beyond inputStart means the item is at/after the cursor
      let items = [makeItem('foobar', { character: 10 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].score).toBe(0)
      expect(filtered[0].positions).toBeUndefined()
    })

    it('should keep only maxItemCount best items', () => {
      let items = fill(500)
      let complete = createComplete(items, { maxItemCount: 10 })
      let filtered = complete.filterItems('word')
      expect(filtered).toHaveLength(10)
      expect(filtered[0].word).toBe('word_0')
      // all 500 items match, only the top 10 by sortText are kept
      let expected = items.slice().sort((a, b) => a.sortText < b.sortText ? -1 : 1).slice(0, 10).map(o => o.word)
      expect(filtered.map(o => o.word)).toEqual(expected)
    })
  })

  describe('Complete.filterResults', () => {
    function makeItem(word: string): DurationCompleteItem {
      return {
        abbr: word,
        word,
        filterText: word,
        score: 0,
        priority: 0,
        sortText: word,
        source: { name: 'test' } as ISource,
        character: 1,
        delta: 0,
      }
    }

    function createComplete(sources: ISource[]): Complete {
      let option = {
        position: Position.create(0, 0),
        bufnr: 1,
        line: 'foo',
        col: 4,
        input: 'foo',
        filetype: '',
        filepath: '',
        word: 'foo',
        followWord: '',
        colnr: 4,
        linenr: 1,
        changedtick: 0,
      } as CompleteOption
      let completeConfig: CompleteConfig = {
        autoTrigger: 'always',
        insertMode: InsertMode.Insert,
        filterGraceful: true,
        enableFloat: true,
        languageSourcePriority: 99,
        snippetsSupport: true,
        defaultSortMethod: SortMethod.Length,
        removeDuplicateItems: false,
        removeCurrentWord: false,
        acceptSuggestionOnCommitCharacter: false,
        triggerCompletionWait: 0,
        triggerAfterInsertEnter: false,
        maxItemCount: 256,
        timeout: 500,
        minTriggerInputLength: 1,
        localityBonus: true,
        highPrioritySourceLimit: null,
        lowPrioritySourceLimit: null,
        ignoreRegexps: [],
        asciiMatch: true,
        asciiCharactersOnly: false,
      }
      return new Complete(option, {} as any, completeConfig, sources)
    }

    it('should not re-trigger incomplete sources on prefix shrink without backspace', async () => {
      let complete = createComplete([{ name: 'test' }] as any)
      ;(complete as any).results.set('test', { items: [makeItem('foo')], isIncomplete: true })
      let spy = vi.spyOn(complete, 'completeInComplete')
      let res = await complete.filterResults('fo')
      expect(res).toBeDefined()
      expect(spy).not.toHaveBeenCalled()
      res = await complete.filterResults('foo')
      expect(res).toBeDefined()
      expect(spy).not.toHaveBeenCalled()
    })

    it('should re-trigger on growing input and on backspace', async () => {
      let complete = createComplete([{ name: 'test' }] as any)
      ;(complete as any).results.set('test', { items: [makeItem('foo')], isIncomplete: true })
      let spy = vi.spyOn(complete, 'completeInComplete')
      let res = await complete.filterResults('foof')
      expect(res).toBeUndefined()
      expect(spy).toHaveBeenCalled()
      spy.mockClear()
      res = await complete.filterResults('', true)
      expect(res).toBeUndefined()
      expect(spy).toHaveBeenCalled()
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
