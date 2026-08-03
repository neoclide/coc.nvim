// Merged from util.test.ts, float.test.ts and sources.test.ts to share a
// single nvim session and reduce per-file startup overhead.
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CancellationToken, CancellationTokenSource, CompletionItem, CompletionItemKind, CompletionItemTag, Disposable, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import Complete, { selectTopItems, sortItems } from '../../completion/complete'
import Floating from '../../completion/floating'
import { caseScore, matchScore, matchScoreWithPositions } from '../../completion/match'
import { Around } from '../../completion/native/around'
import { Buffer } from '../../completion/native/buffer'
import { File, filterFiles, getDirectory, getFileItem, getItemsFromRoot, getLastPart, resolveEnvVariables } from '../../completion/native/file'
import { getInsertWord, prefixWord } from '../../completion/pum'
import Source, { firstMatchFuzzy } from '../../completion/source'
import VimSource, { checkInclude, getMethodName } from '../../completion/source-vim'
import sources, { Sources, getSourceType, logError } from '../../completion/sources'
import { CompleteConfig, CompleteOption, CompleteResult, DurationCompleteItem, ExtendedCompleteItem, InsertMode, ISource, SortMethod, SourceConfig, SourceType } from '../../completion/types'
import { checkIgnoreRegexps, Converter, ConvertOption, createKindMap, deltaCount, emptLabelDetails, getDetail, getDocumentations, getInput, getKindHighlight, getKindText, getPriority, getReplaceRange, getResumeInput, getWord, hasAction, highlightOffset, indentChanged, isWordCode, MruLoader, OptionForWord, Selection, shouldIndent, shouldStop, toCompleteDoneItem } from '../../completion/util'
import { WordDistance } from '../../completion/wordDistance'
import events, { InsertChange } from '../../events'
import extensions from '../../extension'
import languages from '../../languages'
import { Chars } from '../../model/chars'
import { WordsSource } from '../../snippets/util'
import { FloatConfig } from '../../types'
import { disposeAll } from '../../util'
import { getCharCodes } from '../../util/fuzzy'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let source: ISource
const emptyFn = () => Promise.resolve(null)

function getSource(): ISource {
  return sources.getSource('$words')
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

async function waitFloat(kind: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await helper.wait(20)
    let win = await helper.getFloat(kind)
    if (win) return
  }
  throw new Error(`float ${kind} timeout after 1s`)
}

/**
 * Mock the nvim side of the pum detail float: record the payloads sent to
 * `coc#dialog#create_pum_float` and the number of `coc#pum#close_detail`
 * calls, and forward everything else to the real nvim. This removes the
 * window creation/teardown timing from the tests that only assert on the
 * content sent to the float.
 */
function mockFloatCalls() {
  let nvimClient = workspace.nvim
  let original: any = nvimClient.call.bind(nvimClient)
  let createCalls: any[][] = []
  let closeCalls = 0
  let spy = vi.spyOn(nvimClient, 'call').mockImplementation(((method: string, args: any, isNotify?: boolean): Promise<any> => {
    if (method == 'coc#dialog#create_pum_float') {
      createCalls.push(args ?? [])
      return Promise.resolve(0)
    }
    if (method == 'coc#pum#close_detail') {
      closeCalls++
      return Promise.resolve()
    }
    return original(method, args, isNotify)
  }) as any)
  return {
    createCalls,
    get closeCalls(): number {
      return closeCalls
    },
    restore: (): void => {
      spy.mockRestore()
    }
  }
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

describe('completion float', () => {
  beforeAll(async () => {
    source = {
      name: 'float',
      priority: 10,
      enable: true,
      sourceType: SourceType.Native,
      doComplete: (): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{
          word: 'foo',
          info: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
        }, {
          word: 'foot',
          info: 'foot'
        }, {
          word: 'football',
        }]
      })
    }
    sources.addSource(source)
  })
  afterAll(async () => {
    sources.removeSource(source)
  })
  it('should prefix word', () => {
    expect(prefixWord('foo', 0, '', 0)).toBe('foo')
    expect(prefixWord('foo', 1, '$foo', 0)).toBe('$foo')
  })

  it('should get insert word', () => {
    expect(getInsertWord('word', [], 0)).toBe('word')
    expect(getInsertWord('word\nbar', [10], 2)).toBe('word')
  })

  it('should cancel float window', async () => {
    await helper.edit()
    await nvim.setLine('f')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'float' }, true)
    await helper.waitPopup()
    // Wait for the float creation triggered by the pum to finish before
    // confirming, otherwise a late creation could land after the close.
    await waitFloat('pumdetail')
    await helper.confirmCompletion(0)
    await helper.waitFor('coc#float#has_float', [], 0)
  })

  it('should adjust float window position', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await waitFloat('pumdetail')
    let floatWin = await helper.getFloat('pumdetail')
    let config = await floatWin.getConfig()
    expect(config.col + config.width).toBeLessThan(180)
  })

  it('should redraw float window on item change', async () => {
    let mock = mockFloatCalls()
    try {
      await helper.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await helper.visible('foo', 'float')
      // The initial float is created asynchronously after the pum shows up.
      // Wait for it so the redraw below cannot be overtaken by it.
      await vi.waitFor(() => {
        expect(mock.createCalls.length).toBeGreaterThan(0)
      })
      await nvim.call('coc#pum#select', [1, 1, 0])
      // The redraw happens through the same async pipeline; wait until the
      // float content for the newly selected item is sent.
      await vi.waitFor(() => {
        let lines = mock.createCalls[mock.createCalls.length - 1][0] as string[]
        expect(lines.join('\n')).toMatch('foot')
      })
    } finally {
      mock.restore()
    }
  })

  it('should hide float window when item info is empty', async () => {
    let mock = mockFloatCalls()
    try {
      await helper.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await helper.visible('foo', 'float')
      await vi.waitFor(() => {
        expect(mock.createCalls.length).toBeGreaterThan(0)
      })
      let createsBefore = mock.createCalls.length
      await nvim.call('coc#pum#select', [2, 1, 0])
      // Selecting the item without documentation must close the detail float
      // instead of sending new content for it.
      await vi.waitFor(() => {
        expect(mock.closeCalls).toBeGreaterThan(0)
      })
      expect(mock.createCalls.length).toBe(createsBefore)
    } finally {
      mock.restore()
    }
  })

  it('should hide float window after completion', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await waitFloat('pumdetail')
    await nvim.input('<C-n>')
    await nvim.input('<C-y>')
    // Confirming completion closes the pum and its detail float; wait for the
    // actual state instead of relying on a fixed delay.
    await helper.waitFor('coc#float#has_float', [], 0)
  })
})

describe('float config', () => {
  beforeAll(async () => {
    source = {
      name: 'float',
      priority: 10,
      enable: true,
      sourceType: SourceType.Native,
      doComplete: (): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{
          word: 'foo',
          info: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
        }, {
          word: 'foot',
          info: 'foot'
        }, {
          word: 'football',
        }]
      })
    }
    sources.addSource(source)
  })
  afterAll(async () => {
    sources.removeSource(source)
  })

  beforeEach(async () => {
    await nvim.input('of')
    await helper.waitPopup()
  })

  async function createFloat(config: Partial<FloatConfig>, docs = [{ filetype: 'txt', content: 'doc' }]): Promise<Floating> {
    let floating = new Floating({
      floatConfig: {
        border: true,
        ...config
      }
    })
    floating.show(docs)
    return floating
  }

  async function getFloat(): Promise<number> {
    let win = await helper.getFloat('pumdetail')
    return win ? win.id : -1
  }

  async function getRelated(winid: number, kind: string): Promise<number> {
    if (!winid || winid == -1) return -1
    let win = nvim.createWindow(winid)
    let related = await win.getVar('related') as number[]
    if (!related || !related.length) return -1
    for (let id of related) {
      let w = nvim.createWindow(id)
      let v = await w.getVar('kind')
      if (v == kind) {
        return id
      }
    }
    return -1
  }

  it('should not shown with empty lines', async () => {
    await createFloat({}, [{ filetype: 'txt', content: '' }])
    let floatWin = await helper.getFloat('pumdetail')
    expect(floatWin).toBeUndefined()
  })

  it('should show window with border', async () => {
    await createFloat({ border: true, rounded: true, focusable: true })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
  })

  it('should change window highlights', async () => {
    await createFloat({ border: true, highlight: 'WarningMsg', borderhighlight: 'MoreMsg' })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let win = nvim.createWindow(winid)
    let res = await win.getOption('winhl') as string
    expect(res).toMatch('WarningMsg')
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
    win = nvim.createWindow(id)
    res = await win.getOption('winhl') as string
    expect(res).toMatch('MoreMsg')
  })

  it('should add shadow and winblend', async () => {
    await createFloat({ shadow: true, winblend: 30 })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
  })
})

describe('KeywordsBuffer', () => {
  it('should parse keywords', async () => {
    let filepath = await createTmpFile(' ab\nab')
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

  it('should yield match words', async () => {
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
    let iterable = b.matchWords(0)
    expect(getResults(iterable)).toEqual(['_foo', 'bar'])
    iterable = b.matchWords(2)
    expect(getResults(iterable)).toEqual(['_foo', 'bar'])
  })
})

describe('Source', () => {
  function createSource(opt: SourceConfig): Source {
    let s = new Source(opt)
    disposables.push(s)
    return s
  }

  function makeid(length) {
    let result = ''
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let charactersLength = characters.length
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() *
        charactersLength))
    }
    return result
  }

  it('should check trigger only source', async () => {
    expect(typeof Sources).toBe('function')
    logError('')
    let name = 'foo'
    let s = createSource({ name, triggerOnly: true, doComplete: emptyFn })
    expect(s.triggerOnly).toBe(true)
    expect(s.triggerPatterns).toBeNull()
    s = createSource({ name, doComplete: emptyFn })
    helper.updateConfiguration(`coc.source.${name}.triggerPatterns`, [null, 'foo'])
    expect(s.triggerOnly).toBe(true)
  })

  it('should get source type', async () => {
    for (let t of [SourceType.Native, SourceType.Remote, SourceType.Service]) {
      expect(getSourceType(t)).toBeDefined()
    }
  })

  it('should check complete', async () => {
    let name = 'foo'
    let s = createSource({ name, doComplete: emptyFn })
    helper.updateConfiguration(`coc.source.${name}.disableSyntaxes`, ['comment'])
    await nvim.input('i')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.synname = 'Comment'
    expect(await s.checkComplete(opt)).toBe(false)
    let result = await s.doComplete(opt, CancellationToken.None)
    expect(result).toBeNull()
    opt.synname = 'String'
    expect(await s.checkComplete(opt)).toBe(true)
    opt.synname = ''
    expect(await s.checkComplete(opt)).toBe(true)
    s = createSource({
      name, shouldComplete: () => {
        return Promise.resolve(false)
      },
      doComplete: emptyFn
    })
    expect(await s.checkComplete(opt)).toBe(false)
  })

  it('should call optional functions', async () => {
    await nvim.input('i')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let name = 'foo'
    let n = 0
    let s = createSource({
      name,
      doComplete: emptyFn,
      refresh: () => {
        n++
        return Promise.resolve()
      },
      onCompleteDone: () => {
        n++
        return Promise.resolve()
      },
      onCompleteResolve: () => {
        n++
        return Promise.resolve()
      }
    })
    // expect(s.optionalFns).toEqual([])
    await s.refresh()
    await s.onCompleteDone({} as any, opt)
    await s.doComplete(opt, CancellationToken.None)
    await s.onCompleteResolve({} as any, opt, CancellationToken.None)
    expect(n).toBe(3)
  })

  it('should get results', async () => {
    let name = 'foo'
    let s = createSource({ name, doComplete: emptyFn })
    let words = []
    for (let i = 0; i < 80000; i++) {
      words.push(makeid(10))
    }
    let items: Set<string> = new Set()
    let tokenSource = new CancellationTokenSource()
    let p = s.getResults([words], '_$c', '', items, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    expect(res).toBe(true)
    let n = Date.now()
    p = s.getResults([words], '_$a', '', items, CancellationToken.None)
    let spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      return n + 200
    })
    res = await p
    spy.mockRestore()
    words = []
    for (let i = 0; i < 300; i++) {
      words.push('a' + makeid(10))
    }
    items = new Set()
    res = await s.getResults([words], 'a', '', items, CancellationToken.None)
    expect(items.size).toBe(50)
    items = new Set()
    res = await s.getResults([['你好']], 'ni', '', items, CancellationToken.None)
    expect(items.size).toBe(1)
  })
})

describe('vim source', () => {
  function createSourceFile(name: string, content: string): string {
    let dir = path.join(os.tmpdir(), `coc/source`)
    fs.mkdirSync(dir, { recursive: true })
    let filepath = path.join(dir, `${name}.vim`)
    fs.writeFileSync(filepath, content, 'utf8')
    return filepath
  }

  it('should not throw when pluginPath already used', async () => {
    await sources.createVimSources(process.cwd())
    await sources.createVimSources(process.cwd())
  })

  it('should show error for bad source file', async () => {
    let filepath = createSourceFile('tmp', '')
    await sources.createVimSourceExtension(filepath)
    let line = await helper.getCmdline()
    expect(line).toMatch('Error')
  })

  it('should register filetypes extension for vim source', async () => {
    let content = `
function! coc#source#foo#init()
  return {'filetypes': ['vim'], 'firstMatch': v:true}
endfunction
function! coc#source#foo#complete(opt, cb) abort
  call a:cb([])
endfunction `
    let filepath = createSourceFile('foo', content)
    await sources.createVimSourceExtension(filepath)
    let ext = extensions.getExtension('coc-vim-source-foo')
    expect(ext).toBeDefined()
    await Promise.resolve(ext.deactivate())
  })

  it('should retry vim source after input becomes eligible', async () => {
    let content = `
function! coc#source#issue5539#init() abort
  return {'filetypes': ['mediawiki']}
endfunction
function! coc#source#issue5539#should_complete(opt) abort
  return strpart(a:opt.line, 0, a:opt.colnr - 1) =~# '\\[\\[\\k\\{2,}$'
endfunction
function! coc#source#issue5539#complete(opt, cb) abort
  call a:cb(['Microsoft Windows'])
endfunction `
    let filepath = createSourceFile('issue5539', content)
    await sources.createVimSourceExtension(filepath)
    await nvim.command('setfiletype mediawiki')
    await helper.wait(30)

    await nvim.input('i')
    for (let character of '[[Mi') await nvim.input(character)
    await helper.waitPopup()

    expect(helper.completion.activeItems.some(item => item.word == 'Microsoft Windows')).toBe(true)
  })

  it('should not run by check complete', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote,
      remoteFns: ['on_complete', 'on_enter']
    })
    helper.updateConfiguration('coc.source.vim.disableSyntaxes', ['comment'])
    helper.updateConfiguration('coc.source.vim.filetypes', ['vim'])
    opt.synname = 'VimComment'
    opt.filetype = 'vim'
    let res = await source.checkComplete(opt)
    expect(res).toBe(false)
    let result = await source.doComplete(opt, CancellationToken.None)
    expect(result).toBe(null)
    opt.synname = ''
    res = await source.checkComplete(opt)
    expect(res).toBe(true)
    result = await source.doComplete(opt, CancellationToken.Cancelled)
    expect(result).toBe(null)
    source.onEnter(999)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
  })

  it('should register extension for vim source', async () => {
    let content = `
function! coc#source#foo#init()
  return {'firstMatch': v:true, 'isSnippet': v:true}
endfunction

function! coc#source#foo#on_enter(...)
  let g:coc_entered = 1
endfunction

function! coc#source#foo#get_startcol(opt)
  if a:opt['col'] == 1
    return 0
  endif
  return a:opt['col']
endfunction

function! coc#source#foo#complete(opt, cb) abort
  if a:opt['col'] == 0
    call a:cb([{'word': '.f'}])
    return
  endif
  call a:cb([])
endfunction `
    let filepath = createSourceFile('foo', content)
    await sources.createVimSourceExtension(filepath)
    let source = sources.getSource('foo')
    expect(source).toBeDefined()
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
    let val = await nvim.getVar('coc_entered')
    expect(val).toBe(1)
    await nvim.setLine('.')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let res = await source.doComplete(opt, CancellationToken.None)
    expect(res.startcol).toBe(0)
    expect(res.items).toEqual([{ word: '.f', isSnippet: true }])
    opt.col = 2
    res = await source.doComplete(opt, CancellationToken.None)
    expect(res).toBe(null)
  })

  it('should not insert snippet when on_complete exists', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote,
      remoteFns: ['on_complete']
    })
    let item: ExtendedCompleteItem = {
      word: 'word',
      abbr: 'word',
      filterText: 'word',
      isSnippet: true,
      insertText: 'word($1)'
    }
    let spy = vi.spyOn(nvim, 'call').mockImplementation(() => {
      return undefined
    })
    await source.refresh()
    await source.onCompleteDone(item, opt)
    spy.mockRestore()
    let line = await nvim.line
    expect(line).toBe('')
  })

  it('should insert snippet', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote
    })
    let item: ExtendedCompleteItem = {
      word: 'word',
      abbr: 'word',
      filterText: 'word',
      isSnippet: true,
      insertText: 'word($1)'
    }
    await source.onCompleteDone(item, opt)
    let line = await nvim.line
    expect(line).toBe('word()')
  })
})

describe('native sources', () => {
  it('should not complete when buffer not exists', async () => {
    let tokenSource = new CancellationTokenSource()
    let source = sources.getSource('around')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    Object.assign(opt, { bufnr: -1, input: 'a' })
    let res = await source.doComplete(opt, tokenSource.token)
    expect(res).toBeNull()
  })

  it('should not complete when check failed', async () => {
    let tokenSource = new CancellationTokenSource()
    for (const name of ['around', 'buffer', 'file']) {
      let source = sources.getSource(name)
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let spy = vi.spyOn(source, 'checkComplete' as any).mockReturnValue(Promise.resolve(false))
      let res = await source.doComplete(opt, tokenSource.token)
      spy.mockRestore()
      expect(res).toBeNull()
    }
  })

  it('should not complete with empty input', async () => {
    for (const name of ['around', 'buffer']) {
      let tokenSource = new CancellationTokenSource()
      let source = sources.getSources({ source: name } as any)[0]
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let res = await source.doComplete(opt, tokenSource.token)
      expect(res).toBeNull()
    }
  })

  it('should not complete when cancelled', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    Object.assign(opt, { input: 'a' })
    for (const name of ['around', 'buffer']) {
      let source = sources.getSource(name)
      let res = await source.doComplete(opt, CancellationToken.Cancelled)
      expect(res).toBeNull()
    }
  })

  it('should resolveEnvVariables', () => {
    expect(resolveEnvVariables('%HOME%/data%x%', { HOME: '/home' })).toBe('/home/data%x%')
    expect(resolveEnvVariables('$HOME/${USER}/data', { HOME: '/home', USER: 'foo' })).toBe('/home/foo/data')
    expect(resolveEnvVariables('$PART/data', {})).toBe('$PART/data')
  })

  it('should getDirectory', () => {
    expect(getDirectory('a/b', '/home')).toBe('/home/a')
    expect(getDirectory(__dirname, '/home')).toBe(path.dirname(__dirname))
  })

  it('should getItemsFromRoot', async () => {
    let res = await getItemsFromRoot('a/b', '/not_exists', true, [])
    expect(res).toEqual([])
  })

  it('should getLastPart', () => {
    expect(getLastPart('/a/b!/x/y')).toBe('/x/y')
    expect(getLastPart('/a/b /x/y')).toBe('/x/y')
    expect(getLastPart('xy /a/b\\ /x/y')).toBe('/a/b\\ /x/y')
    expect(getLastPart('/a/b/x/y!')).toBeNull()
    expect(getLastPart('x#/')).toBe('/')
    expect(getLastPart('x /')).toBe('/')
    expect(getLastPart('/')).toBe('/')
  })

  it('should getFileItem', async () => {
    expect(await getFileItem(__dirname, '')).toBeDefined()
    expect(await getFileItem(__dirname, 'file_not_exists')).toBeNull()
    expect(await getFileItem(__dirname, path.basename(__filename))).toBeDefined()
  })

  it('should filterFiles', () => {
    expect(filterFiles(['.a', '.b', null], false)).toEqual(['.a', '.b'])
    expect(filterFiles(['a.js', 'b.ts'], true, ['*.js'])).toEqual(['b.ts'])
  })

  it('should getRoot', async () => {
    let file = new File(false)
    let filepath = __filename
    let cwd = process.cwd()
    let root = await file.getRoot('./a', '', '', cwd)
    expect(root).toBe(cwd)
    root = await file.getRoot('./a', '', filepath, cwd)
    expect(root).toBe(path.dirname(filepath))
    root = await file.getRoot('/a/b/', '', filepath, cwd)
    expect(root).toBe('/a/b/')
    root = await file.getRoot('/a/b', '', filepath, cwd)
    expect(root).toBe('/a')
    root = await file.getRoot('', 'a/b/not_exists', filepath, cwd)
    expect(root).toBeUndefined()
    let dir = path.dirname(__dirname)
    let base = path.basename(__dirname)
    root = await file.getRoot('', base, __dirname, cwd)
    expect(root).toBe(dir)
    root = await file.getRoot('', base, '/a/b', dir)
    expect(root).toBe(dir)
    root = await file.getRoot('', '', '', dir)
    expect(root).toBe(dir)
    file.isWindows = true
    root = await file.getRoot('C:\\user', '', filepath, cwd)
    expect(root).toBe('C:\\')
    root = await file.getRoot('C:\\user\\', '', filepath, cwd)
    expect(root).toBe('C:\\user\\')
    let arr = file.triggerCharacters
    expect(arr.includes('\\')).toBe(true)
  })

  it('should firstMatchFuzzy', async () => {
    expect(firstMatchFuzzy(97, true, '_a')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'a')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'A')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'â')).toBe(true)
    expect(firstMatchFuzzy(226, false, 'â')).toBe(true)
  })

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

  it('should trigger for inComplete complete', async () => {
    await nvim.setLine('foo')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.triggerForInComplete = true
    let around = new Around(sources.keywords)
    let res = await around.doComplete(opt, CancellationToken.None)
    expect(res).toBeDefined()
    let buffer = new Buffer(sources.keywords)
    res = await buffer.doComplete(opt, CancellationToken.None)
    expect(res).toBeDefined()
  })

  it('should fix col for file source', async () => {
    await nvim.command(`edit t|setl iskeyword+=/`)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await helper.waitPopup()
  })

  it('should trim ext for file source', async () => {
    let cwd = path.resolve(__dirname, '..')
    let file = path.join(cwd, 't.ts')
    await helper.edit(file)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await helper.waitPopup()
    let items = helper.completion.activeItems
    let idx = items.findIndex(o => o.word.endsWith('.ts'))
    expect(idx).toBe(-1)
  })

  it('should not complete when cancelled', async () => {
    await nvim.setLine('/foo')
    await nvim.input('A')
    let file = new File(false)
    let tokenSource = new CancellationTokenSource()
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let p = file.doComplete(opt, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    expect(res).toBeNull()
  })

  it('should complete with words source', async () => {
    let stats = sources.sourceStats()
    let find = stats.find(o => o.name === '$words')
    expect(find).toBeUndefined()
    expect(WordsSource).toBeDefined()
    let s = sources.getSource('$words') as WordsSource
    expect(s.name).toBe('$words')
    expect(s.shortcut).toBe('')
    expect(s.triggerOnly).toBe(true)
    s.words = ['foo', 'bar']
    s.startcol = 1
    await nvim.setLine('longwords')
    await nvim.input('A')
    nvim.call('coc#start', { source: '$words' }, true)
    await helper.waitPopup()
    let items = await helper.items()
    expect(items.map(o => o.word)).toEqual(['foo', 'bar'])
  })

  it('should get method name', () => {
    expect(getMethodName('f', ['f', 'o'])).toBe('f')
    expect(getMethodName('foo', ['Foo', 'Bar'])).toBe('Foo')
    expect(() => {
      getMethodName('foo', ['Bar'])
    }).toThrow()
    expect(checkInclude('f', ['f', 'o'])).toBe(true)
    expect(checkInclude('b', ['f', 'o'])).toBe(false)
    expect(checkInclude('foo', ['Foo', 'Bar'])).toBe(true)
  })
})
