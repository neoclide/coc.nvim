import completion from '../../completion'
import * as shared from '../sharedUtil'
// Merged from util.test.ts, float.test.ts and sources.test.ts to share a
// single nvim session and reduce per-file startup overhead.
import Complete, { selectTopItems, sortItems } from '../../completion/complete'
import Floating from '../../completion/floating'
import { caseScore, matchScore, matchScoreWithPositions } from '../../completion/match'
import { Around } from '../../completion/native/around'
import { Buffer } from '../../completion/native/buffer'
import { File, filterFiles, getDirectory, getFileItem, getItemsFromRoot, getLastPart, resolveEnvVariables } from '../../completion/native/file'
import { getInsertWord, getItemWidth, prefixWord, PumItems } from '../../completion/pum'
import Source, { firstMatchFuzzy } from '../../completion/source'
import VimSource, { checkInclude, getMethodName } from '../../completion/source-vim'
import sources, { Sources, getSourceType, logError } from '../../completion/sources'
import { CompleteConfig, CompleteOption, CompleteResult, DurationCompleteItem, ExtendedCompleteItem, InsertMode, ISource, SortMethod, SourceConfig, SourceType } from '../../completion/types'
import { applyItemDefaults, checkIgnoreRegexps, Converter, ConvertOption, createKindMap, deltaCount, emptLabelDetails, getDetail, getDocumentations, getInput, getKindHighlight, getKindText, getPriority, getReplaceRange, getResumeInput, getWord, hasAction, highlightOffset, indentChanged, isWordCode, MruLoader, OptionForWord, Selection, shouldIndent, shouldStop, toCompleteDoneItem } from '../../completion/util'
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
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ApplyKind, CancellationToken, CancellationTokenSource, CompletionItem, CompletionItemKind, CompletionItemTag, Disposable, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import type CompleteType from '../../completion/complete'
import type FloatingType from '../../completion/floating'
import type { Converter as ConverterType, OptionForWord as OptionForWordType } from '../../completion/util'
import type { SortMethod as SortMethodType } from '../../completion/types'
import type { PumItems as PumItemsType } from '../../completion/pum'
import type SourceClassType from '../../completion/source'
import type { WordsSource as WordsSourceType } from '../../snippets/util'


let nvim: Neovim
let disposables: Disposable[] = []
let source: ISource
const emptyFn = () => Promise.resolve(null)

function getSource(): ISource {
  return sources.getSource('$words')
}

before(async () => {
  nvim = workspace.nvim
})

afterEach(async () => {
  disposeAll(disposables)
})

async function waitFloat(kind: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await shared.wait(20)
    let win = await shared.getFloat(kind)
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
function mockFloatCalls(t: any) {
  let nvimClient = workspace.nvim
  let original: any = nvimClient.call.bind(nvimClient)
  let createCalls: any[][] = []
  let closeCalls = 0
  t.mock.method(nvimClient, 'call', ((method: string, args: any, isNotify?: boolean): Promise<any> => {
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
    }
  }
}

describe('util functions', () => {
  it('should toCompleteDoneItem', async t => {
    assert.deepStrictEqual(toCompleteDoneItem(undefined, undefined), {})
  })

  it('should getPriority', async t => {
    assert.strictEqual(getPriority(getSource(), 5), 5)
  })

  it('should add documentation', t => {
    let docs = getDocumentations({ label: 'word', detail: 'detail' }, '')
    assert.deepStrictEqual(docs, [{ filetype: 'txt', content: 'detail' }])
    docs = getDocumentations({ label: 'word', documentation: { kind: 'plaintext', value: '' } }, '')
    assert.deepStrictEqual(docs, [])
    docs = getDocumentations({ label: 'word', detail: 'detail' }, '', true)
    assert.deepStrictEqual(docs, [])
    docs = getDocumentations({ label: 'word', detail: 'detail', documentation: { kind: 'markdown', value: 'markdown' } }, 'vim')
    assert.strictEqual(docs.length, 2)
    docs = getDocumentations({ word: '' }, '', true)
    assert.deepStrictEqual(docs, [])
    docs = getDocumentations({ word: '', documentation: [{ content: 'content', filetype: 'vim' }] }, '', true)
    assert.deepStrictEqual(docs, [{ content: 'content', filetype: 'vim' }])
    docs = getDocumentations({ word: '', info: 'info' }, '', true)
    assert.deepStrictEqual(docs, [{ content: 'info', filetype: 'txt' }])
  })

  it('should get detail doc', t => {
    let item: CompletionItem = { label: '', detail: 'detail', labelDetails: {} }
    assert.deepStrictEqual(getDetail(item, ''), { filetype: 'txt', content: 'detail' })
    item = { label: '', detail: 'detail', labelDetails: { detail: 'detail', description: 'desc' } }
    assert.deepStrictEqual(getDetail(item, ''), { filetype: 'txt', content: 'detail desc' })
    item = { label: '', detail: 'detail', labelDetails: { description: 'desc' } }
    assert.deepStrictEqual(getDetail(item, ''), { filetype: 'txt', content: ' desc' })
    item = { label: '', detail: 'detail', labelDetails: { detail: 'detail' } }
    assert.deepStrictEqual(getDetail(item, ''), { filetype: 'txt', content: 'detail' })
    item = { label: '', detail: 'detail()' }
    assert.deepStrictEqual(getDetail(item, 'vim'), { filetype: 'vim', content: 'detail()' })
  })

  it('should get deltaCount', t => {
    let base = { lnum: 1, col: 1, line: '', changedtick: 1, pre: '' }
    let insert: InsertChange = Object.assign({ insertChar: 's' }, base)
    assert.strictEqual(deltaCount(insert), 0)
    insert = Object.assign({ insertChar: 's', insertChars: ['s'] }, base)
    assert.strictEqual(deltaCount(insert), 0)
    insert = Object.assign({ insertChar: 's', insertChars: ['s', 's'] }, base, { pre: 's' })
    assert.strictEqual(deltaCount(insert), 0)
    insert = Object.assign({ insertChar: '<', insertChars: ['<', '>'] }, base, { pre: '<', line: '<x' })
    assert.strictEqual(deltaCount(insert), 0)
    insert = Object.assign({ insertChar: '<', insertChars: ['<', '>'] }, base, { pre: '<', line: '<>' })
    assert.strictEqual(deltaCount(insert), 1)
  })

  it('should get caseScore', t => {
    assert.strictEqual(typeof caseScore(10, 10, 2), 'number')
  })

  it('should check action', async t => {
    assert.strictEqual(hasAction({ label: 'foo', additionalTextEdits: [] }, {}), false)
    assert.strictEqual(hasAction({ label: 'foo', insertTextFormat: InsertTextFormat.Snippet }, {}), true)
  })

  it('should check indentChanged', t => {
    assert.strictEqual(indentChanged(undefined, [1, 1, ''], ''), false)
    assert.strictEqual(indentChanged({ word: 'foo' }, [1, 4, 'foo'], '  foo'), true)
    assert.strictEqual(indentChanged({ word: 'foo' }, [1, 4, 'bar'], '  foo'), false)
  })

  it('should get highlight offset', t => {
    let n = highlightOffset(3, { abbr: 'abc', filterText: 'def' })
    assert.strictEqual(n, -1)
    assert.strictEqual(highlightOffset(3, { abbr: 'abc', filterText: 'abc' }), 3)
    assert.strictEqual(highlightOffset(3, { abbr: 'xy abc', filterText: 'abc' }), 6)
  })

  it('should getKindText', t => {
    assert.strictEqual(getKindText('t', new Map(), ''), 't')
    let m = new Map()
    m.set(CompletionItemKind.Class, 'C')
    assert.strictEqual(getKindText(CompletionItemKind.Class, m, 'D'), 'C')
    assert.strictEqual(getKindText(CompletionItemKind.Class, new Map(), 'D'), 'D')
  })

  it('should getKindHighlight', async t => {
    const testHi = (kind: number | string, res: string) => {
      assert.strictEqual(getKindHighlight(kind), res)
    }
    testHi(CompletionItemKind.Class, 'CocSymbolClass')
    testHi(999, 'CocSymbolDefault')
    testHi('', 'CocSymbolDefault')
  })

  it('should createKindMap', t => {
    let map = createKindMap({ constructor: 'C' })
    assert.strictEqual(map.get(CompletionItemKind.Constructor), 'C')
    map = createKindMap({ constructor: undefined })
    assert.strictEqual(map.get(CompletionItemKind.Constructor), '')
  })

  it('should checkIgnoreRegexps', t => {
    assert.strictEqual(checkIgnoreRegexps([], ''), false)
    assert.strictEqual(checkIgnoreRegexps(['^^*^^'], 'input'), false)
    assert.strictEqual(checkIgnoreRegexps(['^inp', '^ind'], 'input'), true)
  })

  it('should getResumeInput', t => {
    let opt = { line: 'foo', colnr: 4, col: 1, position: { line: 0, character: 3 } }
    assert.strictEqual(getResumeInput(opt, ''), null)
    assert.strictEqual(getResumeInput(opt, 'f'), '')
    assert.strictEqual(getResumeInput(opt, 'bar'), null)
    assert.strictEqual(getResumeInput(opt, 'foot'), 'oot')
  })

  function createOption(bufnr: number, linenr: number, line: string, col: number): Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'col'> {
    return { bufnr, linenr, line, col }
  }

  it('should check stop', t => {
    let opt = createOption(1, 1, 'a', 2)
    assert.strictEqual(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: '' }, opt), true)
    assert.strictEqual(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: ' ' }, opt), true)
    assert.strictEqual(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'fo' }, opt), true)
    assert.strictEqual(shouldStop(2, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'foob' }, opt), true)
    assert.strictEqual(shouldStop(1, { line: '', col: 2, lnum: 2, changedtick: 1, pre: 'foob' }, opt), true)
    assert.strictEqual(shouldStop(1, { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'barb' }, opt), true)
  })

  it('should check indent', t => {
    let res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'endfor')
    assert.strictEqual(res, true)
    res = shouldIndent('', 'endfor')
    assert.strictEqual(res, false)
    res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'foo bar')
    assert.strictEqual(res, false)
    res = shouldIndent('=~endif,=enddef,=endfu,=endfor', 'Endif')
    assert.strictEqual(res, true)
    res = shouldIndent(' ', '')
    assert.strictEqual(res, false)
    res = shouldIndent('*=endif', 'endif')
    assert.strictEqual(res, false)
    res = shouldIndent('0=foo', '  foo')
    assert.strictEqual(res, true)
  })

  it('should check isWordCode', t => {
    let chars = new Chars('@,_,#')
    assert.strictEqual(isWordCode(chars, 97, true), true)
    assert.strictEqual(isWordCode(chars, 97, false), true)
    assert.strictEqual(isWordCode(chars, 10, false), false)
    assert.strictEqual(isWordCode(chars, 0xdc00, false), false)
    assert.strictEqual(isWordCode(chars, 20320, true), false)
  })

  it('should consider none word character as input', t => {
    let chars = new Chars('@,_,#')
    let res = getInput(chars, 'a#b#', false)
    assert.strictEqual(res, 'a#b#')
    res = getInput(chars, '你b#', true)
    assert.strictEqual(res, 'b#')
    res = getInput(chars, '你b#', false)
    assert.strictEqual(res, 'b#')
  })

  it('should check emptLabelDetails', t => {
    assert.strictEqual(emptLabelDetails(null), true)
    assert.strictEqual(emptLabelDetails({}), true)
    assert.strictEqual(emptLabelDetails({ detail: '' }), true)
    assert.strictEqual(emptLabelDetails({ detail: 'detail' }), false)
    assert.strictEqual(emptLabelDetails({ description: 'detail' }), false)
  })

  it('should get word from complete item', t => {
    let item: CompletionItem = { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), '$foo\nbar') }
    let word = getWord(item, {})
    assert.strictEqual(word, '$foo')
    item = { label: 'foo', data: { word: '$foo' } }
    word = getWord(item, {})
    assert.strictEqual(word, '$foo')
    item = { label: 'foo', insertText: 'foo($1)' }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    assert.strictEqual(word, 'foo()')
    word = getWord(item, { insertTextFormat: InsertTextFormat.PlainText })
    assert.strictEqual(word, 'foo($1)')
    item = { label: 'foo' }
    word = getWord(item, {})
    assert.strictEqual(word, 'foo')
    item = { label: 'foo', insertText: 'foo' }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    assert.strictEqual(word, 'foo')
    item = { label: 'foo', insertText: 'foo($1)', kind: CompletionItemKind.Function }
    word = getWord(item, { insertTextFormat: InsertTextFormat.Snippet })
    assert.strictEqual(word, 'foo')
  })

  it('should get replace range', t => {
    let item: CompletionItem = { label: 'foo' }
    assert.strictEqual(getReplaceRange(item, undefined), undefined)
    assert.strictEqual(getReplaceRange(item, undefined, 0), undefined)
    assert.deepStrictEqual(getReplaceRange(item, Range.create(0, 0, 0, 3), 0), Range.create(0, 0, 0, 3))
    assert.deepStrictEqual(getReplaceRange(item, {
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
      , 0), Range.create(0, 0, 0, 3))
    assert.deepStrictEqual(getReplaceRange(item, {
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
      , 0, InsertMode.Insert), Range.create(0, 0, 0, 0))
    item.textEdit = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')
    assert.deepStrictEqual(getReplaceRange(item, undefined, 0), Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 0, 0, 0),
      replace: Range.create(0, 0, 0, 3),
    }
    assert.deepStrictEqual(getReplaceRange(item, undefined, 0), Range.create(0, 0, 0, 3))
    item.textEdit = {
      newText: 'foo',
      insert: Range.create(0, 1, 0, 0),
      replace: Range.create(0, 1, 0, 3),
    }
    assert.deepStrictEqual(getReplaceRange(item, undefined, 0), Range.create(0, 0, 0, 3))
  })

  describe('applyItemDefaults', () => {
    it('should not change item without applyKind and defaults', t => {
      let item: CompletionItem = { label: 'foo', commitCharacters: [','] }
      applyItemDefaults(item, {}, undefined)
      assert.deepStrictEqual(item, { label: 'foo', commitCharacters: [','] })
    })

    it('should merge commitCharacters', t => {
      let item: CompletionItem = { label: 'foo', commitCharacters: [','] }
      applyItemDefaults(item, { commitCharacters: ['.', ','] }, { commitCharacters: ApplyKind.Merge })
      assert.deepStrictEqual(item.commitCharacters, ['.', ','])
    })

    it('should use defaults as commitCharacters on merge when item has none', t => {
      let item: CompletionItem = { label: 'foo' }
      applyItemDefaults(item, { commitCharacters: ['.'] }, { commitCharacters: ApplyKind.Merge })
      assert.deepStrictEqual(item.commitCharacters, ['.'])
    })

    it('should keep item commitCharacters on Replace', t => {
      let item: CompletionItem = { label: 'foo', commitCharacters: [','] }
      applyItemDefaults(item, { commitCharacters: ['.'] }, { commitCharacters: ApplyKind.Replace })
      assert.deepStrictEqual(item.commitCharacters, [','])
    })

    it('should attach default data on Replace', t => {
      let item: CompletionItem = { label: 'foo' }
      applyItemDefaults(item, { data: { id: 1 } }, undefined)
      assert.deepStrictEqual(item.data, { id: 1 })
      let item2: CompletionItem = { label: 'foo', data: {} }
      applyItemDefaults(item2, { data: { id: 1 } }, undefined)
      assert.deepStrictEqual(item2.data, {})
    })

    it('should shallow merge data', t => {
      let item: CompletionItem = { label: 'foo', data: { id: 2, nested: { a: 1 } } }
      applyItemDefaults(item, { data: { id: 1, extra: 'x' } }, { data: ApplyKind.Merge })
      assert.deepStrictEqual(item.data, { id: 2, extra: 'x', nested: { a: 1 } })
    })

    it('should use default data as-is on merge when item data is null', t => {
      let item: CompletionItem = { label: 'foo', data: null }
      applyItemDefaults(item, { data: { id: 1 } }, { data: ApplyKind.Merge })
      assert.deepStrictEqual(item.data, { id: 1 })
    })

    it('should keep non object item data on merge', t => {
      let item: CompletionItem = { label: 'foo', data: ['a'] }
      applyItemDefaults(item, { data: { id: 1 } }, { data: ApplyKind.Merge })
      assert.deepStrictEqual(item.data, ['a'])
    })

    it('should merge item data without default data', t => {
      let item: CompletionItem = { label: 'foo', data: { id: 2 } }
      applyItemDefaults(item, {}, { data: ApplyKind.Merge })
      assert.deepStrictEqual(item.data, { id: 2 })
    })
  })

  describe('Converter', () => {
    function create(inputStart: number, option: ConvertOption, opt: OptionForWordType): ConverterType {
      return new Converter(inputStart, option, opt)
    }

    it('should get previous & after', t => {
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
      assert.strictEqual(c.getPrevious(0), '$')
      assert.strictEqual(c.getPrevious(0), '$')
      assert.strictEqual(c.getAfter(4), 'foo')
      assert.strictEqual(c.getAfter(4), 'foo')
      assert.strictEqual(c.getAfter(2), 'f')
    })

    it('should convert completion item', t => {
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
      assert.strictEqual(res.abbr.endsWith('?'), true)
      assert.strictEqual(typeof res.sortText, 'string')
      assert.strictEqual(res.deprecated, true)
      assert.strictEqual(res.dup, false)
    })

    it('should replace word after cursor', t => {
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
      assert.strictEqual(res.character, 0)
      assert.strictEqual(res.word, 'a')
      item.textEdit = TextEdit.replace(Range.create(0, 1, 0, 4), 'foo')
      item.labelDetails = { description: 'description' }
      res = c.convertToDurationItem(item)
      assert.strictEqual(res.character, 1)
      assert.notStrictEqual(res.labelDetails, undefined)
    })

    it('should convert completion item', t => {
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
      assert.strictEqual(res.filterText, '@foo')
      assert.strictEqual(res.delta, 1)
    })
  })

  describe('matchScore', () => {
    function score(word: string, input: string): number {
      return matchScore(word, getCharCodes(input))
    }

    it('should match score for last letter', t => {
      assert.strictEqual(score('#!3', '3'), 1)
      assert.strictEqual(score('bar', 'f'), 0)
    })

    it('should return 0 when not matched', t => {
      assert.strictEqual(score('and', '你'), 0)
      assert.strictEqual(score('你and', '你的'), 0)
      assert.strictEqual(score('fooBar', 'Bt'), 0)
      assert.strictEqual(score('thisbar', 'tihc'), 0)
    })

    it('should match first letter', t => {
      assert.strictEqual(score('abc', ''), 0)
      assert.strictEqual(score('abc', 'a'), 5)
      assert.strictEqual(score('Abc', 'a'), 2.5)
      assert.strictEqual(score('__abc', 'a'), 2)
      assert.strictEqual(score('$Abc', 'a'), 1)
      assert.strictEqual(score('$Abc', 'A'), 2)
      assert.strictEqual(score('$Abc', '$A'), 6)
      assert.strictEqual(score('$Abc', '$a'), 5.5)
      assert.strictEqual(score('foo_bar', 'b'), 2)
      assert.strictEqual(score('foo_Bar', 'b'), 1)
      assert.strictEqual(score('_foo_Bar', 'b'), 0.5)
      assert.strictEqual(score('_foo_Bar', 'f'), 2)
      assert.strictEqual(score('bar', 'a'), 1)
      assert.strictEqual(score('fooBar', 'B'), 2)
      assert.strictEqual(score('fooBar', 'b'), 1)
      assert.strictEqual(score('fobtoBar', 'bt'), 2)
    })

    it('should match follow letters', t => {
      assert.strictEqual(score('abc', 'ab'), 6)
      assert.strictEqual(score('adB', 'ab'), 5.75)
      assert.strictEqual(score('adb', 'ab'), 5.1)
      assert.strictEqual(score('adCB', 'ab'), 5.05)
      assert.strictEqual(score('a_b_c', 'ab'), 6)
      assert.strictEqual(score('FooBar', 'fb'), 3.25)
      assert.strictEqual(score('FBar', 'fb'), 3)
      assert.strictEqual(score('FooBar', 'FB'), 6)
      assert.strictEqual(score('FBar', 'FB'), 6)
      assert.strictEqual(score('a__b', 'a__b'), 8)
      assert.strictEqual(score('aBc', 'ab'), 5.5)
      assert.strictEqual(score('a_B_c', 'ab'), 5.75)
      assert.strictEqual(score('abc', 'abc'), 7)
      assert.strictEqual(score('abc', 'aC'), 0)
      assert.strictEqual(score('abc', 'ac'), 5.1)
      assert.strictEqual(score('abC', 'ac'), 5.75)
      assert.strictEqual(score('abC', 'aC'), 6)
    })

    it('should only allow search once', t => {
      assert.strictEqual(score('foobar', 'fbr'), 5.2)
      assert.strictEqual(score('foobaRow', 'fbr'), 5.85)
      assert.strictEqual(score('foobaRow', 'fbR'), 6.1)
      assert.strictEqual(score('foobar', 'fa'), 5.1)
    })

    it('should have higher score for strict match', t => {
      assert.strictEqual(score('language-client-protocol', 'lct'), 6.1)
      assert.strictEqual(score('language-client-types', 'lct'), 7)
    })

    it('should find highest score', t => {
      assert.strictEqual(score('ArrayRotateTail', 'art'), 3.6)
    })
  })

  describe('matchScoreWithPositions', () => {
    function assertMatch(word: string, input: string, res: [number, ReadonlyArray<number>] | undefined): void {
      let result = matchScoreWithPositions(word, getCharCodes(input))
      if (!res) {
        assert.strictEqual(result, undefined)
      } else {
        assert.deepStrictEqual(result, res)
      }
    }

    it('should return undefined when not match found', t => {
      assertMatch('a', 'abc', undefined)
      assertMatch('a', '', undefined)
      assertMatch('ab', 'ac', undefined)
    })

    it('should find matches by position fix', t => {
      assertMatch('this', 'tih', [5.6, [0, 1, 2]])
      assertMatch('globalThis', 'tihs', [2.6, [6, 7, 8, 9]])
    })

    it('should find matched positions', t => {
      assertMatch('this', 'th', [6, [0, 1]])
      assertMatch('foo_bar', 'fb', [6, [0, 4]])
      assertMatch('assertMatch', 'am', [5.75, [0, 6]])
    })
  })

  describe('wordDistance', () => {
    it('should empty when not enabled', async t => {
      let w = await WordDistance.create(false, {} as any, CancellationToken.None)
      assert.strictEqual(w.distance(Position.create(0, 0), {} as any), 0)
    })

    it('should empty when selectRanges is empty', async t => {
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      assert.strictEqual(w, WordDistance.None)
    })

    it('should empty when timeout', async t => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 0, 1)
          }]
        }
      }))
      let spy = t.mock.method(workspace, 'computeWordRanges', () => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve(null)
          }, 50)
        })
      })
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      assert.strictEqual(w, WordDistance.None)
    })

    it('should get distance', async t => {
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
      let filepath = await shared.createTmpFile('foo bar\ndef', disposables)
      await shared.edit(filepath)
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      assert.ok(w.distance(Position.create(1, 0), {} as any) > 0)
      assert.ok(w.distance(Position.create(0, 0), { word: '', kind: CompletionItemKind.Keyword } as any) > 0)
      assert.ok(w.distance(Position.create(0, 0), { word: 'not_exists' } as any) > 0)
      assert.strictEqual(w.distance(Position.create(0, 0), { word: 'bar' } as any), 0)
      assert.ok(w.distance(Position.create(0, 0), { word: 'def' } as any) > 0)
      await nvim.call('cursor', [1, 2])
      await events.fire('CursorMoved', [opt.bufnr, [1, 2]])
      assert.strictEqual(w.distance(Position.create(0, 0), { word: 'bar' } as any), 0)
    })

    it('should get same range', async t => {
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
      let spy = t.mock.method(workspace, 'computeWordRanges', () => {
        return Promise.resolve({ foo: [Range.create(0, 0, 0, 0)] })
      })
      let opt = await nvim.call('coc#util#get_complete_option') as any
      opt.word = ''
      let w = await WordDistance.create(true, opt, CancellationToken.None)
      let res = w.distance(Position.create(0, 0), { word: 'foo' } as any)
      assert.strictEqual(res, 0)
    })
  })

  describe('sortItems', () => {
    it('should sort items', t => {
      let emptyInput = false
      let defaultSortMethod: SortMethodType = SortMethod.None
      let a: any = {
        abbr: 'a', character: 0, filterText: 'a', index: 0, source: '', word: 'a'
      }
      let b: any = {
        abbr: 'b', character: 0, filterText: 'b', index: 0, source: '', word: 'b'
      }
      const check = (ap: any, bp: any, res: number) => {
        let val = sortItems(emptyInput, defaultSortMethod, Object.assign(ap, a), Object.assign(bp, b))
        assert.strictEqual(val, res)
      }
      check({ score: 1 }, { score: 2 }, 1)
      check({ priority: 1 }, { priority: 2 }, 1)
      check({ sortText: 'b' }, { sortText: 'a' }, 1)
      check({ sortText: 'a' }, { sortText: 'b' }, -1)
      check({ localBonus: 1 }, { localBonus: 2 }, 1)
    })
  })

  describe('selectTopItems', () => {
    it('should return empty for non-positive count', t => {
      assert.deepStrictEqual(selectTopItems([3, 1, 2], 0, (a, b) => a - b), [])
    })

    it('should sort when array is not larger than count', t => {
      let items = selectTopItems([3, 1, 2], 5, (a, b) => a - b)
      assert.deepStrictEqual(items, [1, 2, 3])
    })

    it('should keep only the best items in order', t => {
      let items = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
      let top = selectTopItems(items, 3, (a, b) => a - b)
      assert.deepStrictEqual(top, [1, 2, 3])
      // original array untouched except when it fits entirely
      assert.deepStrictEqual(items, [10, 1, 9, 2, 8, 3, 7, 4, 6, 5])
    })

    it('should match full sort result for random data', t => {
      let values: number[] = []
      for (let i = 0; i < 500; i++) values.push(Math.floor(Math.random() * 1000))
      let count = 50
      let expected = values.slice().sort((a, b) => a - b).slice(0, count)
      assert.deepStrictEqual(selectTopItems(values, count, (a, b) => a - b), expected)
    })

    it('should keep stable result with equal items', t => {
      let values = [5, 1, 5, 3, 5, 2]
      assert.deepStrictEqual(selectTopItems(values, 4, (a, b) => a - b), [1, 2, 3, 5])
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

    function createComplete(items: DurationCompleteItem[], config?: Partial<CompleteConfig>): CompleteType {
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

    it('should use aggressive scorer for small sets', t => {
      let items = fill(10)
      items.push(makeItem('console'))
      let complete = createComplete(items)
      let filtered = complete.filterItems('cno')
      let item = filtered.find(o => o.word == 'console')
      assert.notStrictEqual(item, undefined)
      // aggressive: ^c^o^nsole
      assert.deepStrictEqual(item.positions.slice(2), [2, 1, 0])
    })

    it('should use graceful scorer for medium sets', t => {
      let items = fill(301)
      items.push(makeItem('console'))
      let complete = createComplete(items)
      let filtered = complete.filterItems('cno')
      let item = filtered.find(o => o.word == 'console')
      assert.notStrictEqual(item, undefined)
      // graceful: ^co^ns^ole
      assert.deepStrictEqual(item.positions.slice(2), [4, 2, 0])
    })

    it('should use plain scorer for large sets', t => {
      let items = fill(2001)
      items.push(makeItem('result'))
      let complete = createComplete(items)
      // 'rlut' only matches 'result' through graceful permutations
      assert.strictEqual(complete.filterItems('rlut').find(o => o.word == 'result'), undefined)
    })

    it('should use plain scorer when graceful is disabled', t => {
      let items = fill(10)
      items.push(makeItem('result'))
      let complete = createComplete(items, { filterGraceful: false })
      assert.strictEqual(complete.filterItems('rlut').find(o => o.word == 'result'), undefined)
    })

    it('should score with delta input using precomputed text', t => {
      let items = [makeItem('foobar', { delta: 3, character: 1 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('bar')
      assert.strictEqual(filtered.length, 1)
      assert.strictEqual(filtered[0].word, 'foobar')
      assert.ok(filtered[0].score > 0)
    })

    it('should score trigger text when input is empty', t => {
      let items = [makeItem('foobar', { character: 1 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('')
      assert.strictEqual(filtered.length, 1)
      assert.notStrictEqual(filtered[0].positions, undefined)
    })

    it('should not match items at cursor when input is empty', t => {
      // character beyond inputStart means the item is at/after the cursor
      let items = [makeItem('foobar', { character: 10 })]
      let complete = createComplete(items)
      let filtered = complete.filterItems('')
      assert.strictEqual(filtered.length, 1)
      assert.strictEqual(filtered[0].score, 0)
      assert.strictEqual(filtered[0].positions, undefined)
    })

    it('should keep only maxItemCount best items', t => {
      let items = fill(500)
      let complete = createComplete(items, { maxItemCount: 10 })
      let filtered = complete.filterItems('word')
      assert.strictEqual(filtered.length, 10)
      assert.strictEqual(filtered[0].word, 'word_0')
      // all 500 items match, only the top 10 by sortText are kept
      let expected = items.slice().sort((a, b) => a.sortText < b.sortText ? -1 : 1).slice(0, 10).map(o => o.word)
      assert.deepStrictEqual(filtered.map(o => o.word), expected)
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

    function createComplete(sources: ISource[]): CompleteType {
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

    it('should not re-trigger incomplete sources on prefix shrink without backspace', async t => {
      let complete = createComplete([{ name: 'test' }] as any)
      ;(complete as any).results.set('test', { items: [makeItem('foo')], isIncomplete: true })
      let spy = t.mock.method(complete, 'completeInComplete', async () => {})
      let res = await complete.filterResults('fo')
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(spy.mock.callCount(), 0)
      res = await complete.filterResults('foo')
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(spy.mock.callCount(), 0)
    })

    it('should re-trigger on growing input and on backspace', async t => {
      let complete = createComplete([{ name: 'test' }] as any)
      ;(complete as any).results.set('test', { items: [makeItem('foo')], isIncomplete: true })
      let spy = t.mock.method(complete, 'completeInComplete', async () => {})
      let res = await complete.filterResults('foof')
      assert.strictEqual(res, undefined)
      assert.ok(spy.mock.callCount() > 0)
      spy.mock.resetCalls()
      res = await complete.filterResults('', true)
      assert.strictEqual(res, undefined)
      assert.ok(spy.mock.callCount() > 0)
    })

  })

  describe('MruLoader', () => {
    it('should add item without prefix', t => {
      let loader = new MruLoader()
      loader.add('foo', { kind: '', source: getSource(), filterText: 'foo' })
      let item = { kind: CompletionItemKind.Class, source: getSource(), filterText: '$foo' }
      loader.add('foo', item)
      let score = loader.getScore('', item, Selection.RecentlyUsed)
      assert.ok(score > -1)
      score = loader.getScore('a', item, Selection.RecentlyUsedByPrefix)
      assert.strictEqual(score, -1)
      score = loader.getScore('f', item, Selection.RecentlyUsed)
      assert.ok(score > -1)
    })
  })
})

describe('completion float', () => {
  afterEach(editorReset)

  before(async () => {
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
  after(async () => {
    sources.removeSource(source)
  })
  it('should prefix word', t => {
    assert.strictEqual(prefixWord('foo', 0, '', 0), 'foo')
    assert.strictEqual(prefixWord('foo', 1, '$foo', 0), '$foo')
  })

  it('should get insert word', t => {
    assert.strictEqual(getInsertWord('word', [], 0), 'word')
    assert.strictEqual(getInsertWord('word\nbar', [10], 2), 'word')
  })

  it('should get item width', t => {
    let config = {
      border: false,
      abbrWidth: 6,
      menuWidth: 5,
      kindWidth: 1,
      shortcutWidth: 4
    }
    assert.strictEqual(getItemWidth(PumItems.Abbr, config), 7)
    assert.strictEqual(getItemWidth(PumItems.Menu, config), 6)
    assert.strictEqual(getItemWidth(PumItems.Kind, config), 2)
    assert.strictEqual(getItemWidth(PumItems.Shortcut, config), 5)
  })

  it('should get zero width for hidden fields', t => {
    let config = {
      border: false,
      abbrWidth: 0,
      menuWidth: 0,
      kindWidth: 0,
      shortcutWidth: 0
    }
    // abbr slot is always rendered even when its width is 0
    assert.strictEqual(getItemWidth(PumItems.Abbr, config), 1)
    assert.strictEqual(getItemWidth(PumItems.Menu, config), 0)
    assert.strictEqual(getItemWidth(PumItems.Kind, config), 0)
    assert.strictEqual(getItemWidth(PumItems.Shortcut, config), 0)
    assert.strictEqual(getItemWidth('invalid' as PumItemsType, config), 0)
  })

  it('should cancel float window', async t => {
    await shared.edit()
    await nvim.setLine('f')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'float' }, true)
    await shared.waitPopup()
    // Wait for the float creation triggered by the pum to finish before
    // confirming, otherwise a late creation could land after the close.
    await waitFloat('pumdetail')
    await shared.confirmCompletion(0)
    await shared.waitFor('coc#float#has_float', [], 0)
  })

  it('should adjust float window position', async t => {
    await shared.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await shared.visible('foo', 'float')
    await waitFloat('pumdetail')
    let floatWin = await shared.getFloat('pumdetail')
    let config = await floatWin.getConfig()
    assert.ok(config.col + config.width < 180)
  })

  it('should redraw float window on item change', async t => {
    let mock = mockFloatCalls(t)
    try {
      await shared.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await shared.visible('foo', 'float')
      // The initial float is created asynchronously after the pum shows up.
      // Wait for it so the redraw below cannot be overtaken by it.
      await shared.waitValue(() => mock.createCalls.length > 0, true)
      await nvim.call('coc#pum#select', [1, 1, 0])
      // The redraw happens through the same async pipeline; wait until the
      // float content for the newly selected item is sent.
      await shared.waitValue(() => {
        let lines = mock.createCalls[mock.createCalls.length - 1][0] as string[]
        return lines.join('\n').includes('foot')
      }, true)
    } finally {
      mock.restore()
    }
  })

  it('should hide float window when item info is empty', async t => {
    let mock = mockFloatCalls(t)
    try {
      await shared.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await shared.visible('foo', 'float')
      await shared.waitValue(() => mock.createCalls.length > 0, true)
      let createsBefore = mock.createCalls.length
      await nvim.call('coc#pum#select', [2, 1, 0])
      // Selecting the item without documentation must close the detail float
      // instead of sending new content for it.
      await shared.waitValue(() => mock.closeCalls > 0, true)
      assert.strictEqual(mock.createCalls.length, createsBefore)
    } finally {
      mock.restore()
    }
  })

  it('should hide float window after completion', async t => {
    await shared.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await shared.visible('foo', 'float')
    await waitFloat('pumdetail')
    await nvim.input('<C-n>')
    await nvim.input('<C-y>')
    // Confirming completion closes the pum and its detail float; wait for the
    // actual state instead of relying on a fixed delay.
    await shared.waitFor('coc#float#has_float', [], 0)
  })
})

describe('float config', () => {
  afterEach(editorReset)

  before(async () => {
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
  after(async () => {
    sources.removeSource(source)
  })

  beforeEach(async () => {
    await nvim.input('of')
    await shared.waitPopup()
  })

  async function createFloat(config: Partial<FloatConfig>, docs = [{ filetype: 'txt', content: 'doc' }]): Promise<FloatingType> {
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
    let win = await shared.getFloat('pumdetail')
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

  it('should not shown with empty lines', async t => {
    await createFloat({}, [{ filetype: 'txt', content: '' }])
    let floatWin = await shared.getFloat('pumdetail')
    assert.strictEqual(floatWin, undefined)
  })

  it('should show window with border', async t => {
    await createFloat({ border: true, rounded: true, focusable: true })
    let winid = await getFloat()
    assert.ok(winid > 0)
    let id = await getRelated(winid, 'border')
    assert.ok(id > 0)
  })

  it('should change window highlights', async t => {
    await createFloat({ border: true, highlight: 'WarningMsg', borderhighlight: 'MoreMsg' })
    let winid = await getFloat()
    assert.ok(winid > 0)
    let win = nvim.createWindow(winid)
    let res = await win.getOption('winhl') as string
    assert.match(res, new RegExp('WarningMsg'))
    let id = await getRelated(winid, 'border')
    assert.ok(id > 0)
    win = nvim.createWindow(id)
    res = await win.getOption('winhl') as string
    assert.match(res, new RegExp('MoreMsg'))
  })

  it('should add shadow and winblend', async t => {
    await createFloat({ shadow: true, winblend: 30 })
    let winid = await getFloat()
    assert.ok(winid > 0)
  })
})

describe('KeywordsBuffer', () => {
  afterEach(editorReset)

  it('should parse keywords', async t => {
    let filepath = await shared.createTmpFile(' ab\nab')
    let doc = await shared.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    let words = b.getWords()
    assert.deepStrictEqual(words, ['ab'])
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
    words = b.getWords()
    assert.deepStrictEqual(words, ['foo', 'bar', 'ab'])
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 1, 3), 'def ')])
    words = b.getWords()
    assert.deepStrictEqual(words, ['def', 'ab'])
  })

  it('should yield match words', async t => {
    let filepath = await shared.createTmpFile(`_foo\nbar\n`)
    let doc = await shared.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    const getResults = (iterable: Iterable<string>) => {
      let res: string[] = []
      for (let word of iterable) {
        res.push(word)
      }
      return res
    }
    let iterable = b.matchWords(0)
    assert.deepStrictEqual(getResults(iterable), ['_foo', 'bar'])
    iterable = b.matchWords(2)
    assert.deepStrictEqual(getResults(iterable), ['_foo', 'bar'])
  })
})

describe('Source', () => {
  afterEach(editorReset)

  function createSource(opt: SourceConfig): SourceClassType {
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

  it('should check trigger only source', async t => {
    assert.strictEqual(typeof Sources, 'function')
    logError('')
    let name = 'foo'
    let s = createSource({ name, triggerOnly: true, doComplete: emptyFn })
    assert.strictEqual(s.triggerOnly, true)
    assert.strictEqual(s.triggerPatterns, null)
    s = createSource({ name, doComplete: emptyFn })
    shared.updateConfiguration(`coc.source.${name}.triggerPatterns`, [null, 'foo'])
    assert.strictEqual(s.triggerOnly, true)
  })

  it('should get source type', async t => {
    for (let t of [SourceType.Native, SourceType.Remote, SourceType.Service]) {
      assert.notStrictEqual(getSourceType(t), undefined)
    }
  })

  it('should check complete', async t => {
    let name = 'foo'
    let s = createSource({ name, doComplete: emptyFn })
    shared.updateConfiguration(`coc.source.${name}.disableSyntaxes`, ['comment'])
    await nvim.input('i')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.synname = 'Comment'
    assert.strictEqual(await s.checkComplete(opt), false)
    let result = await s.doComplete(opt, CancellationToken.None)
    assert.strictEqual(result, null)
    opt.synname = 'String'
    assert.strictEqual(await s.checkComplete(opt), true)
    opt.synname = ''
    assert.strictEqual(await s.checkComplete(opt), true)
    s = createSource({
      name, shouldComplete: () => {
        return Promise.resolve(false)
      },
      doComplete: emptyFn
    })
    assert.strictEqual(await s.checkComplete(opt), false)
  })

  it('should call optional functions', async t => {
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
    assert.strictEqual(n, 3)
  })

  it('should get results', async t => {
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
    assert.strictEqual(res, true)
    let n = Date.now()
    p = s.getResults([words], '_$a', '', items, CancellationToken.None)
    let spy = t.mock.method(Date, 'now', () => {
      return n + 200
    })
    res = await p
    words = []
    for (let i = 0; i < 300; i++) {
      words.push('a' + makeid(10))
    }
    items = new Set()
    res = await s.getResults([words], 'a', '', items, CancellationToken.None)
    assert.strictEqual(items.size, 50)
    items = new Set()
    res = await s.getResults([['你好']], 'ni', '', items, CancellationToken.None)
    assert.strictEqual(items.size, 1)
  })
})

describe('vim source', () => {
  afterEach(editorReset)

  function createSourceFile(name: string, content: string): string {
    let dir = path.join(os.tmpdir(), `coc/source`)
    fs.mkdirSync(dir, { recursive: true })
    let filepath = path.join(dir, `${name}.vim`)
    fs.writeFileSync(filepath, content, 'utf8')
    return filepath
  }

  it('should not throw when pluginPath already used', async t => {
    await sources.createVimSources(process.cwd())
    await sources.createVimSources(process.cwd())
  })

  it('should show error for bad source file', async t => {
    let filepath = createSourceFile('tmp', '')
    await sources.createVimSourceExtension(filepath)
    let line = await shared.getCmdline()
    assert.match(line, new RegExp('Error'))
  })

  it('should register filetypes extension for vim source', async t => {
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
    assert.notStrictEqual(ext, undefined)
    await Promise.resolve(ext.deactivate())
  })

  it('should retry vim source after input becomes eligible', async t => {
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
    await shared.wait(30)

    await nvim.input('i')
    for (let character of '[[Mi') await nvim.input(character)
    await shared.waitPopup()

    assert.strictEqual(completion.activeItems.some(item => item.word == 'Microsoft Windows'), true)
  })

  it('should not run by check complete', async t => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote,
      remoteFns: ['on_complete', 'on_enter']
    })
    shared.updateConfiguration('coc.source.vim.disableSyntaxes', ['comment'])
    shared.updateConfiguration('coc.source.vim.filetypes', ['vim'])
    opt.synname = 'VimComment'
    opt.filetype = 'vim'
    let res = await source.checkComplete(opt)
    assert.strictEqual(res, false)
    let result = await source.doComplete(opt, CancellationToken.None)
    assert.strictEqual(result, null)
    opt.synname = ''
    res = await source.checkComplete(opt)
    assert.strictEqual(res, true)
    result = await source.doComplete(opt, CancellationToken.Cancelled)
    assert.strictEqual(result, null)
    source.onEnter(999)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
  })

  it('should register extension for vim source', async t => {
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
    assert.notStrictEqual(source, undefined)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
    let val = await nvim.getVar('coc_entered')
    assert.strictEqual(val, 1)
    await nvim.setLine('.')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let res = await source.doComplete(opt, CancellationToken.None)
    assert.strictEqual(res.startcol, 0)
    assert.deepStrictEqual(res.items, [{ word: '.f', isSnippet: true }])
    opt.col = 2
    res = await source.doComplete(opt, CancellationToken.None)
    assert.strictEqual(res, null)
  })

  it('should not insert snippet when on_complete exists', async t => {
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
    let spy = t.mock.method(nvim, 'call', () => {
      return Promise.resolve(undefined)
    })
    await source.refresh()
    await source.onCompleteDone(item, opt)
    let line = await nvim.line
    assert.strictEqual(line, '')
  })

  it('should insert snippet', async t => {
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
    assert.strictEqual(line, 'word()')
  })
})

describe('native sources', () => {
  afterEach(editorReset)

  it('should not complete when buffer not exists', async t => {
    let tokenSource = new CancellationTokenSource()
    let source = sources.getSource('around')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    Object.assign(opt, { bufnr: -1, input: 'a' })
    let res = await source.doComplete(opt, tokenSource.token)
    assert.strictEqual(res, null)
  })

  it('should not complete when check failed', async t => {
    let tokenSource = new CancellationTokenSource()
    for (const name of ['around', 'buffer', 'file']) {
      let source = sources.getSource(name)
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let spy = t.mock.method(source as any, 'checkComplete', () => Promise.resolve(false))
      let res = await source.doComplete(opt, tokenSource.token)
      assert.strictEqual(res, null)
    }
  })

  it('should not complete with empty input', async t => {
    for (const name of ['around', 'buffer']) {
      let tokenSource = new CancellationTokenSource()
      let source = sources.getSources({ source: name } as any)[0]
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let res = await source.doComplete(opt, tokenSource.token)
      assert.strictEqual(res, null)
    }
  })

  it('should not complete when cancelled', async t => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    Object.assign(opt, { input: 'a' })
    for (const name of ['around', 'buffer']) {
      let source = sources.getSource(name)
      let res = await source.doComplete(opt, CancellationToken.Cancelled)
      assert.strictEqual(res, null)
    }
  })

  it('should resolveEnvVariables', t => {
    assert.strictEqual(resolveEnvVariables('%HOME%/data%x%', { HOME: '/home' }), '/home/data%x%')
    assert.strictEqual(resolveEnvVariables('$HOME/${USER}/data', { HOME: '/home', USER: 'foo' }), '/home/foo/data')
    assert.strictEqual(resolveEnvVariables('$PART/data', {}), '$PART/data')
  })

  it('should getDirectory', t => {
    assert.strictEqual(getDirectory('a/b', '/home'), '/home/a')
    assert.strictEqual(getDirectory(import.meta.dirname, '/home'), path.dirname(import.meta.dirname))
  })

  it('should getItemsFromRoot', async t => {
    let res = await getItemsFromRoot('a/b', '/not_exists', true, [])
    assert.deepStrictEqual(res, [])
  })

  it('should getLastPart', t => {
    assert.strictEqual(getLastPart('/a/b!/x/y'), '/x/y')
    assert.strictEqual(getLastPart('/a/b /x/y'), '/x/y')
    assert.strictEqual(getLastPart('xy /a/b\\ /x/y'), '/a/b\\ /x/y')
    assert.strictEqual(getLastPart('/a/b/x/y!'), null)
    assert.strictEqual(getLastPart('x#/'), '/')
    assert.strictEqual(getLastPart('x /'), '/')
    assert.strictEqual(getLastPart('/'), '/')
  })

  it('should getFileItem', async t => {
    assert.notStrictEqual(await getFileItem(import.meta.dirname, ''), undefined)
    assert.strictEqual(await getFileItem(import.meta.dirname, 'file_not_exists'), null)
    assert.notStrictEqual(await getFileItem(import.meta.dirname, path.basename(import.meta.filename)), undefined)
  })

  it('should filterFiles', t => {
    assert.deepStrictEqual(filterFiles(['.a', '.b', null], false), ['.a', '.b'])
    assert.deepStrictEqual(filterFiles(['a.js', 'b.ts'], true, ['*.js']), ['b.ts'])
  })

  it('should getRoot', async t => {
    let file = new File(false)
    let filepath = import.meta.filename
    let cwd = process.cwd()
    let root = await file.getRoot('./a', '', '', cwd)
    assert.strictEqual(root, cwd)
    root = await file.getRoot('./a', '', filepath, cwd)
    assert.strictEqual(root, path.dirname(filepath))
    root = await file.getRoot('/a/b/', '', filepath, cwd)
    assert.strictEqual(root, '/a/b/')
    root = await file.getRoot('/a/b', '', filepath, cwd)
    assert.strictEqual(root, '/a')
    root = await file.getRoot('', 'a/b/not_exists', filepath, cwd)
    assert.strictEqual(root, undefined)
    let dir = path.dirname(import.meta.dirname)
    let base = path.basename(import.meta.dirname)
    root = await file.getRoot('', base, import.meta.dirname, cwd)
    assert.strictEqual(root, dir)
    root = await file.getRoot('', base, '/a/b', dir)
    assert.strictEqual(root, dir)
    root = await file.getRoot('', '', '', dir)
    assert.strictEqual(root, dir)
    file.isWindows = true
    root = await file.getRoot('C:\\user', '', filepath, cwd)
    assert.strictEqual(root, 'C:\\')
    root = await file.getRoot('C:\\user\\', '', filepath, cwd)
    assert.strictEqual(root, 'C:\\user\\')
    let arr = file.triggerCharacters
    assert.strictEqual(arr.includes('\\'), true)
  })

  it('should firstMatchFuzzy', async t => {
    assert.strictEqual(firstMatchFuzzy(97, true, '_a'), true)
    assert.strictEqual(firstMatchFuzzy(97, true, 'a'), true)
    assert.strictEqual(firstMatchFuzzy(97, true, 'A'), true)
    assert.strictEqual(firstMatchFuzzy(97, true, 'â'), true)
    assert.strictEqual(firstMatchFuzzy(226, false, 'â'), true)
  })

  it('should works for around source', async t => {
    let doc = await workspace.document
    await nvim.setLine('foo ')
    await doc.synchronize()
    let { mode } = await nvim.mode
    assert.strictEqual(mode, 'n')
    await nvim.input('Af')
    await shared.waitPopup()
    let res = await shared.visible('foo', 'around')
    assert.strictEqual(res, true)
    await nvim.input('<esc>')
  })

  it('should works for buffer source', async t => {
    await shared.createDocument()
    await nvim.command('set hidden')
    let doc = await shared.createDocument()
    await nvim.setLine('other')
    await nvim.command('bp')
    await doc.synchronize()
    let { mode } = await nvim.mode
    assert.strictEqual(mode, 'n')
    await nvim.input('io')
    let res = await shared.visible('other', 'buffer')
    assert.strictEqual(res, true)
  })

  it('should trigger for inComplete complete', async t => {
    await nvim.setLine('foo')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.triggerForInComplete = true
    let around = new Around(sources.keywords)
    let res = await around.doComplete(opt, CancellationToken.None)
    assert.notStrictEqual(res, undefined)
    let buffer = new Buffer(sources.keywords)
    res = await buffer.doComplete(opt, CancellationToken.None)
    assert.notStrictEqual(res, undefined)
  })

  it('should fix col for file source', async t => {
    await nvim.command(`edit t|setl iskeyword+=/`)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await shared.waitPopup()
  })

  it('should trim ext for file source', async t => {
    let cwd = path.resolve(import.meta.dirname, '..')
    let file = path.join(cwd, 't.ts')
    await shared.edit(file)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await shared.waitPopup()
    let items = completion.activeItems
    let idx = items.findIndex(o => o.word.endsWith('.ts'))
    assert.strictEqual(idx, -1)
  })

  it('should not complete when cancelled', async t => {
    await nvim.setLine('/foo')
    await nvim.input('A')
    let file = new File(false)
    let tokenSource = new CancellationTokenSource()
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let p = file.doComplete(opt, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    assert.strictEqual(res, null)
  })

  it('should complete with words source', async t => {
    let stats = sources.sourceStats()
    let find = stats.find(o => o.name === '$words')
    assert.strictEqual(find, undefined)
    assert.notStrictEqual(WordsSource, undefined)
    let s = sources.getSource('$words') as WordsSourceType
    assert.strictEqual(s.name, '$words')
    assert.strictEqual(s.shortcut, '')
    assert.strictEqual(s.triggerOnly, true)
    s.words = ['foo', 'bar']
    s.startcol = 1
    await nvim.setLine('longwords')
    await nvim.input('A')
    nvim.call('coc#start', { source: '$words' }, true)
    await shared.waitPopup()
    let items = await shared.items()
    assert.deepStrictEqual(items.map(o => o.word), ['foo', 'bar'])
  })

  it('should get method name', t => {
    assert.strictEqual(getMethodName('f', ['f', 'o']), 'f')
    assert.strictEqual(getMethodName('foo', ['Foo', 'Bar']), 'Foo')
    assert.throws(() => {
      getMethodName('foo', ['Bar'])
    })
    assert.strictEqual(checkInclude('f', ['f', 'o']), true)
    assert.strictEqual(checkInclude('b', ['f', 'o']), false)
    assert.strictEqual(checkInclude('foo', ['Foo', 'Bar']), true)
  })
})
