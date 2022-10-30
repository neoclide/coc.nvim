import { Neovim } from '@chemzqm/neovim'
import * as assert from 'assert'
import { CompletionItemKind, Disposable, CancellationToken, Position, Range } from 'vscode-languageserver-protocol'
import { caseScore, matchScore, matchScoreWithPositions } from '../../completion/match'
import { checkIgnoreRegexps, indentChanged, createKindMap, getInput, getKindText, getResumeInput, getValidWord, highlightOffert, shouldIndent, shouldStop } from '../../completion/util'
import { WordDistance } from '../../completion/wordDistance'
import { isWhitespaceAtPos, fuzzyScore, isSeparatorAtPos, isPatternInWord, createMatches, FuzzyScorer, fuzzyScoreGraceful, fuzzyScoreGracefulAggressive, anyScore, fuzzyMatchScoreWithPositions, nextTypoPermutation } from '../../completion/filter'
import languages from '../../languages'
import { CompleteOption } from '../../types'
import { disposeAll } from '../../util'
import { getCharCodes } from '../../util/fuzzy'
import workspace from '../../workspace'
import events from '../../events'
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

describe('filter functions', () => {
  function assertMatches(pattern: string, word: string, decoratedWord: string | undefined, filter: FuzzyScorer, opts: { patternPos?: number; wordPos?: number; firstMatchCanBeWeak?: boolean } = {}) {
    const r = filter(pattern, pattern.toLowerCase(), opts.patternPos || 0, word, word.toLowerCase(), opts.wordPos || 0, { firstMatchCanBeWeak: opts.firstMatchCanBeWeak ?? false, boostFullMatch: true })
    assert.ok(!decoratedWord === !r)
    if (r) {
      const matches = createMatches(r)
      let actualWord = ''
      let pos = 0
      for (const match of matches) {
        actualWord += word.substring(pos, match.start)
        actualWord += '^' + word.substring(match.start, match.end).split('').join('^')
        pos = match.end
      }
      actualWord += word.substring(pos)
      assert.strictEqual(actualWord, decoratedWord)
    }
  }

  function assertTopScore(filter: typeof fuzzyScore, pattern: string, expected: number, ...words: string[]) {
    let topScore = -(100 * 10)
    let topIdx = 0
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      const m = filter(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0)
      if (m) {
        const [score] = m
        if (score > topScore) {
          topScore = score
          topIdx = i
        }
      }
    }
    assert.strictEqual(topIdx, expected, `${pattern} -> actual=${words[topIdx]} <> expected=${words[expected]}`)
  }

  test('isWhitespaceAtPos()', () => {
    expect(isWhitespaceAtPos('abc', -1)).toBe(false)
    expect(isWhitespaceAtPos('abc', 0)).toBe(false)
    expect(isWhitespaceAtPos(' bc', 0)).toBe(true)
  })

  test('isSeparatorAtPos()', () => {
    expect(isSeparatorAtPos('abc', -1)).toBe(false)
    expect(isSeparatorAtPos('abc', 6)).toBe(false)
    expect(isSeparatorAtPos('abc', 0)).toBe(false)
    expect(isSeparatorAtPos(' abc', 0)).toBe(true)
    expect(isSeparatorAtPos('😕abc', 0)).toBe(true)
  })

  test('isPatternInWord()', () => {
    const check = (pattern: string, word: string, patternPos = 0, wordPos = 0, result: boolean) => {
      let res = isPatternInWord(pattern.toLowerCase(), patternPos, pattern.length, word.toLowerCase(), wordPos, word.length)
      expect(res).toBe(result)
    }
    check('abc', 'defabc', 0, 0, true)
    check('abc', 'defabc', 0, 4, false)
    check('abc', 'defab/c', 0, 0, true)
  })

  test('fuzzyScore, #23215', function() {
    assertMatches('tit', 'win.tit', 'win.^t^i^t', fuzzyScore)
    assertMatches('title', 'win.title', 'win.^t^i^t^l^e', fuzzyScore)
    assertMatches('WordCla', 'WordCharacterClassifier', '^W^o^r^dCharacter^C^l^assifier', fuzzyScore)
    assertMatches('WordCCla', 'WordCharacterClassifier', '^W^o^r^d^Character^C^l^assifier', fuzzyScore)
  })

  test('fuzzyScore, #23332', function() {
    assertMatches('dete', '"editor.quickSuggestionsDelay"', undefined, fuzzyScore)
  })

  test('fuzzyScore, #23190', function() {
    assertMatches('c:\\do', '& \'C:\\Documents and Settings\'', '& \'^C^:^\\^D^ocuments and Settings\'', fuzzyScore)
    assertMatches('c:\\do', '& \'c:\\Documents and Settings\'', '& \'^c^:^\\^D^ocuments and Settings\'', fuzzyScore)
  })

  test('fuzzyScore, #23581', function() {
    assertMatches('close', 'css.lint.importStatement', '^css.^lint.imp^ort^Stat^ement', fuzzyScore)
    assertMatches('close', 'css.colorDecorators.enable', '^css.co^l^orDecorator^s.^enable', fuzzyScore)
    assertMatches('close', 'workbench.quickOpen.closeOnFocusOut', 'workbench.quickOpen.^c^l^o^s^eOnFocusOut', fuzzyScore)
    assertTopScore(fuzzyScore, 'close', 2, 'css.lint.importStatement', 'css.colorDecorators.enable', 'workbench.quickOpen.closeOnFocusOut')
  })

  test('fuzzyScore, #23458', function() {
    assertMatches('highlight', 'editorHoverHighlight', 'editorHover^H^i^g^h^l^i^g^h^t', fuzzyScore)
    assertMatches('hhighlight', 'editorHoverHighlight', 'editor^Hover^H^i^g^h^l^i^g^h^t', fuzzyScore)
    assertMatches('dhhighlight', 'editorHoverHighlight', undefined, fuzzyScore)
  })
  test('fuzzyScore, #23746', function() {
    assertMatches('-moz', '-moz-foo', '^-^m^o^z-foo', fuzzyScore)
    assertMatches('moz', '-moz-foo', '-^m^o^z-foo', fuzzyScore)
    assertMatches('moz', '-moz-animation', '-^m^o^z-animation', fuzzyScore)
    assertMatches('moza', '-moz-animation', '-^m^o^z-^animation', fuzzyScore)
  })

  test('fuzzyScore', () => {
    assertMatches('ab', 'abA', '^a^bA', fuzzyScore)
    assertMatches('ccm', 'cacmelCase', '^ca^c^melCase', fuzzyScore)
    assertMatches('bti', 'the_black_knight', undefined, fuzzyScore)
    assertMatches('ccm', 'camelCase', undefined, fuzzyScore)
    assertMatches('cmcm', 'camelCase', undefined, fuzzyScore)
    assertMatches('BK', 'the_black_knight', 'the_^black_^knight', fuzzyScore)
    assertMatches('KeyboardLayout=', 'KeyboardLayout', undefined, fuzzyScore)
    assertMatches('LLL', 'SVisualLoggerLogsList', 'SVisual^Logger^Logs^List', fuzzyScore)
    assertMatches('LLLL', 'SVilLoLosLi', undefined, fuzzyScore)
    assertMatches('LLLL', 'SVisualLoggerLogsList', undefined, fuzzyScore)
    assertMatches('TEdit', 'TextEdit', '^Text^E^d^i^t', fuzzyScore)
    assertMatches('TEdit', 'TextEditor', '^Text^E^d^i^tor', fuzzyScore)
    assertMatches('TEdit', 'Textedit', '^Text^e^d^i^t', fuzzyScore)
    assertMatches('TEdit', 'text_edit', '^text_^e^d^i^t', fuzzyScore)
    assertMatches('TEditDit', 'TextEditorDecorationType', '^Text^E^d^i^tor^Decorat^ion^Type', fuzzyScore)
    assertMatches('TEdit', 'TextEditorDecorationType', '^Text^E^d^i^torDecorationType', fuzzyScore)
    assertMatches('Tedit', 'TextEdit', '^Text^E^d^i^t', fuzzyScore)
    assertMatches('ba', '?AB?', undefined, fuzzyScore)
    assertMatches('bkn', 'the_black_knight', 'the_^black_^k^night', fuzzyScore)
    assertMatches('bt', 'the_black_knight', 'the_^black_knigh^t', fuzzyScore)
    assertMatches('ccm', 'camelCasecm', '^camel^Casec^m', fuzzyScore)
    assertMatches('fdm', 'findModel', '^fin^d^Model', fuzzyScore)
    assertMatches('fob', 'foobar', '^f^oo^bar', fuzzyScore)
    assertMatches('fobz', 'foobar', undefined, fuzzyScore)
    assertMatches('foobar', 'foobar', '^f^o^o^b^a^r', fuzzyScore)
    assertMatches('form', 'editor.formatOnSave', 'editor.^f^o^r^matOnSave', fuzzyScore)
    assertMatches('g p', 'Git: Pull', '^Git:^ ^Pull', fuzzyScore)
    assertMatches('g p', 'Git: Pull', '^Git:^ ^Pull', fuzzyScore)
    assertMatches('gip', 'Git: Pull', '^G^it: ^Pull', fuzzyScore)
    assertMatches('gip', 'Git: Pull', '^G^it: ^Pull', fuzzyScore)
    assertMatches('gp', 'Git: Pull', '^Git: ^Pull', fuzzyScore)
    assertMatches('gp', 'Git_Git_Pull', '^Git_Git_^Pull', fuzzyScore)
    assertMatches('is', 'ImportStatement', '^Import^Statement', fuzzyScore)
    assertMatches('is', 'isValid', '^i^sValid', fuzzyScore)
    assertMatches('lowrd', 'lowWord', '^l^o^wWo^r^d', fuzzyScore)
    assertMatches('myvable', 'myvariable', '^m^y^v^aria^b^l^e', fuzzyScore)
    assertMatches('no', '', undefined, fuzzyScore)
    assertMatches('no', 'match', undefined, fuzzyScore)
    assertMatches('ob', 'foobar', undefined, fuzzyScore)
    assertMatches('sl', 'SVisualLoggerLogsList', '^SVisual^LoggerLogsList', fuzzyScore)
    assertMatches('sllll', 'SVisualLoggerLogsList', '^SVisua^l^Logger^Logs^List', fuzzyScore)
    assertMatches('Three', 'HTMLHRElement', undefined, fuzzyScore)
    assertMatches('Three', 'Three', '^T^h^r^e^e', fuzzyScore)
    assertMatches('fo', 'barfoo', undefined, fuzzyScore)
    assertMatches('fo', 'bar_foo', 'bar_^f^oo', fuzzyScore)
    assertMatches('fo', 'bar_Foo', 'bar_^F^oo', fuzzyScore)
    assertMatches('fo', 'bar foo', 'bar ^f^oo', fuzzyScore)
    assertMatches('fo', 'bar.foo', 'bar.^f^oo', fuzzyScore)
    assertMatches('fo', 'bar/foo', 'bar/^f^oo', fuzzyScore)
    assertMatches('fo', 'bar\\foo', 'bar\\^f^oo', fuzzyScore)
  })

  test('fuzzyScore (first match can be weak)', function() {

    assertMatches('Three', 'HTMLHRElement', 'H^TML^H^R^El^ement', fuzzyScore, { firstMatchCanBeWeak: true })
    assertMatches('tor', 'constructor', 'construc^t^o^r', fuzzyScore, { firstMatchCanBeWeak: true })
    assertMatches('ur', 'constructor', 'constr^ucto^r', fuzzyScore, { firstMatchCanBeWeak: true })
    assertTopScore(fuzzyScore, 'tor', 2, 'constructor', 'Thor', 'cTor')
  })

  test('fuzzyScore, many matches', function() {

    assertMatches(
      'aaaaaa',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '^a^a^a^a^a^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fuzzyScore
    )
  })

  test('Freeze when fjfj -> jfjf, https://github.com/microsoft/vscode/issues/91807', function() {
    assertMatches(
      'jfjfj',
      'fjfjfjfjfjfjfjfjfjfjfj',
      undefined, fuzzyScore
    )
    assertMatches(
      'jfjfjfjfjfjfjfjfjfj',
      'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
      undefined, fuzzyScore
    )
    assertMatches(
      'jfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfj',
      'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
      undefined, fuzzyScore
    )
    assertMatches(
      'jfjfjfjfjfjfjfjfjfj',
      'fJfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
      'f^J^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^jfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj', // strong match
      fuzzyScore
    )
    assertMatches(
      'jfjfjfjfjfjfjfjfjfj',
      'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
      'f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^jfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj', // any match
      fuzzyScore, { firstMatchCanBeWeak: true }
    )
  })

  test('fuzzyScore, issue #26423', function() {

    assertMatches('baba', 'abababab', undefined, fuzzyScore)

    assertMatches(
      'fsfsfs',
      'dsafdsafdsafdsafdsafdsafdsafasdfdsa',
      undefined,
      fuzzyScore
    )
    assertMatches(
      'fsfsfsfsfsfsfsf',
      'dsafdsafdsafdsafdsafdsafdsafasdfdsafdsafdsafdsafdsfdsafdsfdfdfasdnfdsajfndsjnafjndsajlknfdsa',
      undefined,
      fuzzyScore
    )
  })

  test('Fuzzy IntelliSense matching vs Haxe metadata completion, #26995', function() {
    assertMatches('f', ':Foo', ':^Foo', fuzzyScore)
    assertMatches('f', ':foo', ':^foo', fuzzyScore)
  })

  test('Separator only match should not be weak #79558', function() {
    assertMatches('.', 'foo.bar', 'foo^.bar', fuzzyScore)
  })

  test('Cannot set property \'1\' of undefined, #26511', function() {
    const word = new Array<void>(123).join('a')
    const pattern = new Array<void>(120).join('a')
    fuzzyScore(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0)
    assert.ok(true) // must not explode
  })

  test('Vscode 1.12 no longer obeys \'sortText\' in completion items (from language server), #26096', function() {
    assertMatches('  ', '  group', undefined, fuzzyScore, { patternPos: 2 })
    assertMatches('  g', '  group', '  ^group', fuzzyScore, { patternPos: 2 })
    assertMatches('g', '  group', '  ^group', fuzzyScore)
    assertMatches('g g', '  groupGroup', undefined, fuzzyScore)
    assertMatches('g g', '  group Group', '  ^group^ ^Group', fuzzyScore)
    assertMatches(' g g', '  group Group', '  ^group^ ^Group', fuzzyScore, { patternPos: 1 })
    assertMatches('zz', 'zzGroup', '^z^zGroup', fuzzyScore)
    assertMatches('zzg', 'zzGroup', '^z^z^Group', fuzzyScore)
    assertMatches('g', 'zzGroup', 'zz^Group', fuzzyScore)
  })

  test('patternPos isn\'t working correctly #79815', function() {
    assertMatches(':p'.substr(1), 'prop', '^prop', fuzzyScore, { patternPos: 0 })
    assertMatches(':p', 'prop', '^prop', fuzzyScore, { patternPos: 1 })
    assertMatches(':p', 'prop', undefined, fuzzyScore, { patternPos: 2 })
    assertMatches(':p', 'proP', 'pro^P', fuzzyScore, { patternPos: 1, wordPos: 1 })
    assertMatches(':p', 'aprop', 'a^prop', fuzzyScore, { patternPos: 1, firstMatchCanBeWeak: true })
    assertMatches(':p', 'aprop', undefined, fuzzyScore, { patternPos: 1, firstMatchCanBeWeak: false })
  })

  test('topScore - fuzzyScore', function() {

    assertTopScore(fuzzyScore, 'cons', 2, 'ArrayBufferConstructor', 'Console', 'console')
    assertTopScore(fuzzyScore, 'Foo', 1, 'foo', 'Foo', 'foo')

    // #24904
    assertTopScore(fuzzyScore, 'onMess', 1, 'onmessage', 'onMessage', 'onThisMegaEscape')

    assertTopScore(fuzzyScore, 'CC', 1, 'camelCase', 'CamelCase')
    assertTopScore(fuzzyScore, 'cC', 0, 'camelCase', 'CamelCase')
    // assertTopScore(fuzzyScore, 'cC', 1, 'ccfoo', 'camelCase');
    // assertTopScore(fuzzyScore, 'cC', 1, 'ccfoo', 'camelCase', 'foo-cC-bar');

    // issue #17836
    // assertTopScore(fuzzyScore, 'TEdit', 1, 'TextEditorDecorationType', 'TextEdit', 'TextEditor');
    assertTopScore(fuzzyScore, 'p', 4, 'parse', 'posix', 'pafdsa', 'path', 'p')
    assertTopScore(fuzzyScore, 'pa', 0, 'parse', 'pafdsa', 'path')

    // issue #14583
    assertTopScore(fuzzyScore, 'log', 3, 'HTMLOptGroupElement', 'ScrollLogicalPosition', 'SVGFEMorphologyElement', 'log', 'logger')
    assertTopScore(fuzzyScore, 'e', 2, 'AbstractWorker', 'ActiveXObject', 'else')

    // issue #14446
    assertTopScore(fuzzyScore, 'workbench.sideb', 1, 'workbench.editor.defaultSideBySideLayout', 'workbench.sideBar.location')

    // issue #11423
    assertTopScore(fuzzyScore, 'editor.r', 2, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace')
    // assertTopScore(fuzzyScore, 'editor.R', 1, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace');
    // assertTopScore(fuzzyScore, 'Editor.r', 0, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace');

    assertTopScore(fuzzyScore, '-mo', 1, '-ms-ime-mode', '-moz-columns')
    // dupe, issue #14861
    assertTopScore(fuzzyScore, 'convertModelPosition', 0, 'convertModelPositionToViewPosition', 'convertViewToModelPosition')
    // dupe, issue #14942
    assertTopScore(fuzzyScore, 'is', 0, 'isValidViewletId', 'import statement')

    assertTopScore(fuzzyScore, 'title', 1, 'files.trimTrailingWhitespace', 'window.title')

    assertTopScore(fuzzyScore, 'const', 1, 'constructor', 'const', 'cuOnstrul')
  })

  test('Unexpected suggestion scoring, #28791', function() {
    assertTopScore(fuzzyScore, '_lines', 1, '_lineStarts', '_lines')
    assertTopScore(fuzzyScore, '_lines', 1, '_lineS', '_lines')
    assertTopScore(fuzzyScore, '_lineS', 0, '_lineS', '_lines')
  })

  test('HTML closing tag proposal filtered out #38880', function() {
    assertMatches('\t\t<', '\t\t</body>', '^\t^\t^</body>', fuzzyScore, { patternPos: 0 })
    assertMatches('\t\t<', '\t\t</body>', '\t\t^</body>', fuzzyScore, { patternPos: 2 })
    assertMatches('\t<', '\t</body>', '\t^</body>', fuzzyScore, { patternPos: 1 })
  })

  test('fuzzyScoreGraceful', () => {

    assertMatches('rlut', 'result', undefined, fuzzyScore)
    assertMatches('rlut', 'result', '^res^u^l^t', fuzzyScoreGraceful)

    assertMatches('cno', 'console', '^co^ns^ole', fuzzyScore)
    assertMatches('cno', 'console', '^co^ns^ole', fuzzyScoreGraceful)
    assertMatches('cno', 'console', '^c^o^nsole', fuzzyScoreGracefulAggressive)
    assertMatches('cno', 'co_new', '^c^o_^new', fuzzyScoreGraceful)
    assertMatches('cno', 'co_new', '^c^o_^new', fuzzyScoreGracefulAggressive)
  })

  test('List highlight filter: Not all characters from match are highlighterd #66923', () => {
    assertMatches('foo', 'barbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo', 'barbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_^f^o^o', fuzzyScore)
  })

  test('Autocompletion is matched against truncated filterText to 54 characters #74133', () => {
    assertMatches(
      'foo',
      'ffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
      'ffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_^f^o^o',
      fuzzyScore
    )
    assertMatches(
      'Aoo',
      'Affffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
      '^Affffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_f^o^o',
      fuzzyScore
    )
    assertMatches(
      'foo',
      'Gffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
      undefined,
      fuzzyScore
    )
  })

  test('"Go to Symbol" with the exact method name doesn\'t work as expected #84787', function() {
    const match = fuzzyScore(':get', ':get', 1, 'get', 'get', 0, { firstMatchCanBeWeak: true, boostFullMatch: true })
    assert.ok(Boolean(match))
  })

  test('Wrong highlight after emoji #113404', function() {
    assertMatches('di', '✨div classname=""></div>', '✨^d^iv classname=""></div>', fuzzyScore)
    assertMatches('di', 'adiv classname=""></div>', 'adiv classname=""></^d^iv>', fuzzyScore)
  })

  test('Suggestion is not highlighted #85826', function() {
    assertMatches('SemanticTokens', 'SemanticTokensEdits', '^S^e^m^a^n^t^i^c^T^o^k^e^n^sEdits', fuzzyScore)
    assertMatches('SemanticTokens', 'SemanticTokensEdits', '^S^e^m^a^n^t^i^c^T^o^k^e^n^sEdits', fuzzyScoreGracefulAggressive)
  })

  test('IntelliSense completion not correctly highlighting text in front of cursor #115250', function() {
    assertMatches('lo', 'log', '^l^og', fuzzyScore)
    assertMatches('.lo', 'log', '^l^og', anyScore)
    assertMatches('.', 'log', 'log', anyScore)
  })

  test('configurable full match boost', function() {
    const prefix = 'create'
    const a = 'createModelServices'
    const b = 'create'

    const aBoost = fuzzyScore(prefix, prefix, 0, a, a.toLowerCase(), 0, { boostFullMatch: true, firstMatchCanBeWeak: true })
    const bBoost = fuzzyScore(prefix, prefix, 0, b, b.toLowerCase(), 0, { boostFullMatch: true, firstMatchCanBeWeak: true })
    assert.ok(aBoost)
    assert.ok(bBoost)
    assert.ok(aBoost[0] < bBoost[0])

    const aScore = fuzzyScore(prefix, prefix, 0, a, a.toLowerCase(), 0, { boostFullMatch: false, firstMatchCanBeWeak: true })
    const bScore = fuzzyScore(prefix, prefix, 0, b, b.toLowerCase(), 0, { boostFullMatch: false, firstMatchCanBeWeak: true })
    assert.ok(aScore)
    assert.ok(bScore)
    assert.ok(aScore[0] === bScore[0])
  })

  test('Unexpected suggest highlighting ignores whole word match in favor of matching first letter#147423', function() {

    assertMatches('i', 'machine/{id}', 'machine/{^id}', fuzzyScore)
    assertMatches('ok', 'obobobf{ok}/user', '^obobobf{o^k}/user', fuzzyScore)
  })

  test('fuzzyMatchScoreWithPositions', () => {
    let pattern = 'abcd'
    let word = 'xyz_ab_cdef'
    let res = fuzzyMatchScoreWithPositions(word, word.toLowerCase(), pattern, pattern.toLowerCase())
    expect(res).toBeDefined()
    expect(res[1]).toEqual([4, 5, 7, 8])
  })

  test('nextTypoPermutation', () => {
    expect(nextTypoPermutation('abc', 2)).toBeUndefined()
  })

  test('createMatches()', () => {
    expect(createMatches(undefined)).toEqual([])
  })
})

describe('caseScore()', () => {
  it('should get caseScore', () => {
    expect(typeof caseScore(10, 10, 2)).toBe('number')
  })
})

describe('indentChanged()', () => {
  it('should check indentChanged', () => {
    expect(indentChanged(undefined, [1, 1, ''], '')).toBe(false)
    expect(indentChanged({ word: 'foo' }, [1, 4, 'foo'], '  foo')).toBe(true)
    expect(indentChanged({ word: 'foo' }, [1, 4, 'bar'], '  foo')).toBe(false)
  })
})

describe('highlightOffert()', () => {
  it('should get highlight offset', () => {
    let n = highlightOffert(3, { abbr: 'abc', word: '', filterText: 'def' })
    expect(n).toBe(-1)
    expect(highlightOffert(3, { abbr: 'abc', word: '', filterText: 'abc' })).toBe(3)
    expect(highlightOffert(3, { abbr: 'xy abc', word: '', filterText: 'abc' })).toBe(6)
  })
})

describe('getKindText()', () => {
  it('should getKindText', () => {
    expect(getKindText('t', new Map(), '')).toBe('t')
    let m = new Map()
    m.set(CompletionItemKind.Class, 'C')
    expect(getKindText(CompletionItemKind.Class, m, 'D')).toBe('C')
    expect(getKindText(CompletionItemKind.Class, new Map(), 'D')).toBe('D')
  })
})

describe('createKindMap()', () => {
  it('should createKindMap', () => {
    let map = createKindMap({ constructor: 'C' })
    expect(map.get(CompletionItemKind.Constructor)).toBe('C')
    map = createKindMap({ constructor: undefined })
    expect(map.get(CompletionItemKind.Constructor)).toBe('')
  })
})

describe('getValidWord()', () => {
  it('should getValidWord', () => {
    expect(getValidWord('label', [])).toBe('label')
  })
})

describe('checkIgnoreRegexps()', () => {
  it('should checkIgnoreRegexps', () => {
    expect(checkIgnoreRegexps([], '')).toBe(false)
    expect(checkIgnoreRegexps(['^^*^^'], 'input')).toBe(false)
    expect(checkIgnoreRegexps(['^inp', '^ind'], 'input')).toBe(true)
  })
})

describe('getResumeInput()', () => {
  it('should getResumeInput', () => {
    let opt = { line: 'foo', colnr: 4, col: 1 }
    expect(getResumeInput(opt, 'f')).toBeNull()
    expect(getResumeInput(opt, 'bar')).toBeNull()
    expect(getResumeInput(opt, 'foo f')).toBeNull()
  })
})

describe('shouldStop()', () => {
  function createOption(bufnr: number, linenr: number, line: string, colnr: number): Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'colnr'> {
    return { bufnr, linenr, line, colnr }
  }

  it('should check stop', () => {
    let opt = createOption(1, 1, 'a', 2)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: '' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: ' ' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'fo' }, opt)).toBe(true)
    expect(shouldStop(2, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 2, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'barb' }, opt)).toBe(true)
  })
})

describe('shouldIndent()', () => {
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
  })
})

describe('getInput()', () => {
  it('should consider none word character as input', async () => {
    let doc = await helper.createDocument('t.vim')
    let res = getInput(doc, 'a#b#', false)
    expect(res).toBe('a#b#')
    res = getInput(doc, '你b#', true)
    expect(res).toBe('b#')
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
    expect(w.distance(Position.create(0, 0), { word: '', kind: CompletionItemKind.Keyword })).toBeGreaterThan(0)
    expect(w.distance(Position.create(0, 0), { word: 'not_exists' })).toBeGreaterThan(0)
    expect(w.distance(Position.create(0, 0), { word: 'bar' })).toBe(0)
    expect(w.distance(Position.create(0, 0), { word: 'def' })).toBeGreaterThan(0)
    await nvim.call('cursor', [1, 2])
    await events.fire('CursorMoved', [opt.bufnr, [1, 2]])
    expect(w.distance(Position.create(0, 0), { word: 'bar' })).toBe(0)
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
    let res = w.distance(Position.create(0, 0), { word: 'foo' })
    expect(res).toBe(0)
  })
})
