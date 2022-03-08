import style from 'ansi-styles'
import * as assert from 'assert'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { Color, Position, Range, SymbolKind, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { concurrent, executable, getKeymapModifier, getUri, isRunning, runCommand, wait, watchFile } from '../../util'
import { ansiparse, parseAnsiHighlights } from '../../util/ansiparse'
import * as arrays from '../../util/array'
import * as color from '../../util/color'
import { getSymbolKind } from '../../util/convert'
import { ChangedLines, diffLines, getChange, patchLine } from '../../util/diff'
import * as factory from '../../util/factory'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { groupPositions, positions, score } from '../../util/fzy'
import * as Is from '../../util/is'
import * as lodash from '../../util/lodash'
import { Mutex } from '../../util/mutex'
import * as objects from '../../util/object'
import { comparePosition, getChangedPosition, isSingleLine, positionInRange, rangeInRange, rangeOverlap } from '../../util/position'
import { terminate } from '../../util/processes'
import { getMatchResult } from '../../util/score'
import * as strings from '../../util/string'
import { getWellformedEdit } from '../../util/textedit'
import helper, { createTmpFile } from '../helper'
const createLogger = require('../../util/logger')

describe('factory', () => {
  const emptyLogger = {
    log: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {}
  }

  it('should create logger', async () => {
    let file = path.join(__dirname, 'sandbox/log.js')
    let fn = jest.fn()
    const sandbox = factory.createSandbox(file, {
      log: () => {
        fn()
      },
      info: () => {
        fn()
      },
      error: () => {
        fn()
      },
      debug: () => {
        fn()
      },
      warn: () => {
        fn()
      }
    })
    let res = vm.runInContext(`
console.log('log')
console.debug('debug')
console.info('info')
console.error('error')
console.warn('warn')`, sandbox)
    expect(fn).toBeCalledTimes(5)
  })

  it('should not throw process.chdir', async () => {
    let file = path.join(__dirname, 'sandbox/log.js')
    const sandbox = factory.createSandbox(file, emptyLogger)
    let res = vm.runInContext(`process.chdir()`, sandbox)
    expect(res).toBeUndefined()
  })

  it('should throw with umask', async () => {
    let file = path.join(__dirname, 'sandbox/log.js')
    const sandbox = factory.createSandbox(file, emptyLogger)
    let res = vm.runInContext(`process.umask()`, sandbox)
    expect(typeof res).toBe('number')
    let err
    try {
      res = vm.runInContext(`process.umask(18)`, sandbox)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw with process.exit', async () => {
    let file = path.join(__dirname, 'sandbox/log.js')
    const sandbox = factory.createSandbox(file, emptyLogger)
    let err
    try {
      vm.runInContext(`process.exit()`, sandbox)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should hook require', async () => {
    let filename = path.join(__dirname, 'sandbox/log.js')
    const sandbox = factory.createSandbox(filename, emptyLogger)
    let fn = factory.compileInSandbox(sandbox)
    let obj: any = {}
    fn.apply(obj, [`const {wait} = require('coc.nvim')\nmodule.exports = wait`, filename])
    expect(typeof obj.exports).toBe('function')
  })
})

describe('logger', () => {
  it('should get log file', async () => {
    let val = process.env.NVIM_COC_LOG_FILE
    process.env.NVIM_COC_LOG_FILE = ''
    let logger = createLogger('')
    expect(logger.getLogFile()).toBeDefined()
    process.env.XDG_RUNTIME_DIR = ''
    expect(logger.getLogFile()).toBeDefined()
    process.env.NVIM_COC_LOG_FILE = val
  })
})

describe('textedit', () => {
  it('should get well formed edit', async () => {
    let r = Range.create(1, 0, 0, 0)
    let edit: TextEdit = { range: r, newText: 'foo' }
    let res = getWellformedEdit(edit)
    expect(res.range).toEqual(Range.create(0, 0, 1, 0))
  })
})

describe('strings', () => {
  it('should get character indexes', async () => {
    expect(strings.getCharIndexes('abaca', 'a')).toEqual([0, 2, 4])
    expect(strings.getCharIndexes('abd', 'f')).toEqual([])
  })

  it('should get parts', async () => {
    let res = strings.rangeParts('foo bar', Range.create(0, 0, 0, 4))
    expect(res).toEqual(['', 'bar'])
    res = strings.rangeParts('foo\nbar', Range.create(0, 1, 1, 1))
    expect(res).toEqual(['f', 'ar'])
    res = strings.rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 2, 3))
    expect(res).toEqual(['x', '\ny'])
    res = strings.rangeParts('foo\nbar', Range.create(1, 0, 1, 1))
    expect(res).toEqual(['foo\n', 'ar'])
  })

  it('should equalsIgnoreCase', () => {
    expect(strings.equalsIgnoreCase('', '')).toBe(true)
    expect(!strings.equalsIgnoreCase('', '1')).toBe(true)
    expect(!strings.equalsIgnoreCase('1', '')).toBe(true)
    expect(strings.equalsIgnoreCase('a', 'a')).toBe(true)
    expect(strings.equalsIgnoreCase('abc', 'Abc')).toBe(true)
    expect(strings.equalsIgnoreCase('abc', 'ABC')).toBe(true)
    expect(strings.equalsIgnoreCase('Höhenmeter', 'HÖhenmeter')).toBe(true)
    expect(strings.equalsIgnoreCase('ÖL', 'Öl')).toBe(true)
  })

  it('should check isWord', async () => {
    expect(strings.isWord('_')).toBe(true)
    expect(strings.isWord('0')).toBe(true)
  })

  it('should find index', () => {
    expect(strings.indexOf('a,b,c', ',', 2)).toBe(3)
    expect(strings.indexOf('a,b,c', ',', 1)).toBe(1)
    expect(strings.indexOf('a,b,c', 't', 1)).toBe(-1)
  })

  it('should upperFirst', async () => {
    expect(strings.upperFirst('')).toBe('')
    expect(strings.upperFirst('abC')).toBe('AbC')
  })
})

describe('getSymbolKind()', () => {
  it('should get symbol kind', async () => {
    for (let i = 1; i <= 27; i++) {
      expect(getSymbolKind(i as SymbolKind)).toBeDefined()
    }
  })
})

describe('Is', () => {
  it('should check array', async () => {
    expect(Is.array(false)).toBe(false)
  })

  it('should check empty object', async () => {
    expect(Is.emptyObject(false)).toBe(false)
    expect(Is.emptyObject({})).toBe(true)
    expect(Is.emptyObject({ x: 1 })).toBe(false)
  })

  it('should check typed array', async () => {
    let arr = new Array(10)
    arr.fill(1)
    expect(Is.typedArray<Uint32Array>(arr, v => {
      return v >= 0
    })).toBe(true)
  })
})

describe('lodash', () => {
  it('should set defaults', async () => {
    let res = lodash.defaults({ a: 1 }, { b: 2 }, { a: 3 }, null)
    expect(res).toEqual({ a: 1, b: 2 })
  })
})

describe('color', () => {
  it('should check dark color', async () => {
    expect(color.isDark(Color.create(0.03, 0.01, 0.01, 0))).toBe(true)
  })
})

describe('parseAnsiHighlights', () => {
  function testColorHighlight(highlight: string, hlGroup: string, markdown = true) {
    let text = `${style[highlight].open}text${style[highlight].close}`
    let res = parseAnsiHighlights(text, markdown)
    expect(res.highlights.length).toBeGreaterThan(0)
    let o = res.highlights.find(o => o.hlGroup == hlGroup)
    expect(o).toBeDefined()
  }

  it('should parse foreground color', async () => {
    testColorHighlight('yellow', 'CocMarkdownCode')
    testColorHighlight('blue', 'CocMarkdownLink')
    testColorHighlight('magenta', 'CocMarkdownHeader')
    testColorHighlight('green', 'CocListFgGreen')
    testColorHighlight('green', 'CocListFgGreen', false)
  })

  it('should parse background color', async () => {
    let text = `${style.bgRed.open}text${style.bgRed.close}`
    let res = parseAnsiHighlights(text, false)
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.highlights[0].hlGroup).toBe('CocListBgRed')
  })

  it('should parse foreground and background', async () => {
    let text = `${style.bgRed.open}${style.blue.open}text${style.blue.close}${style.bgRed.close}`
    let res = parseAnsiHighlights(text, true)
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.highlights[0].hlGroup).toBe('CocListBlueRed')
  })

  it('should erase char', async () => {
    let text = `foo\u0008bar`
    let res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('fobar')
    text = `${style.bgRed.open}foo${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('fobar')
    text = `${style.bgRed.open}f${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('bar')
  })

  it('should not throw for bad control character', async () => {
    let text = '\x1bafoo'
    let res = parseAnsiHighlights(text)
    expect(res.line).toBeDefined()
    text = '\x1b[33;44mabc\x1b[33,44m'
    res = parseAnsiHighlights(text)
    expect(res.line).toBe('abc')
  })
})

describe('Arrays', () => {

  test('distinct', () => {
    function compare(a: string): string {
      return a
    }

    assert.deepStrictEqual(arrays.distinct(['32', '4', '5'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '4'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', '5', '1'], compare), ['32', 'constructor', '5', '1'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', 'proto', 'proto', 'constructor'], compare), ['32', 'constructor', 'proto'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '32', '4', '5', '32', '4', '5', '5'], compare), ['32', '4', '5'])
  })

  test('tail', () => {
    assert.strictEqual(arrays.tail([1, 2, 3]), 3)
  })

  test('intersect', () => {
    assert.ok(!arrays.intersect([1, 2, 3], [4, 5]))
  })

  test('group', () => {
    let res = arrays.group([1, 2, 3, 4, 5], 3)
    assert.deepStrictEqual(res, [[1, 2, 3], [4, 5]])
  })

  test('groupBy', () => {
    let res = arrays.groupBy([0, 0, 3, 4], v => v != 0)
    assert.deepStrictEqual(res, [[3, 4], [0, 0]])
  })

  test('lastIndex', () => {
    let res = arrays.lastIndex([1, 2, 3], x => x < 3)
    assert.strictEqual(res, 1)
  })

  test('flatMap', () => {
    let objs: { [key: string]: number[] }[] = [{ x: [1, 2] }, { y: [3, 4] }, { z: [5, 6] }]
    function values(item: { [key: string]: number[] }): number[] {
      return Object.keys(item).reduce((p, c) => p.concat(item[c]), [])
    }
    let res = arrays.flatMap(objs, values)
    assert.deepStrictEqual(res, [1, 2, 3, 4, 5, 6])
  })
})

describe('Position', () => {
  function addPosition(position: Position, line: number, character: number): Position {
    return Position.create(position.line + line, position.character + character)
  }

  test('rangeInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(rangeInRange(r, r)).toBe(true)
    expect(rangeInRange(r, Range.create(addPosition(pos, 1, 0), pos))).toBe(false)
  })

  test('rangeOverlap', () => {
    let r = Range.create(0, 0, 0, 0)
    expect(rangeOverlap(r, Range.create(0, 0, 0, 0))).toBe(false)
    expect(rangeOverlap(Range.create(0, 0, 0, 10), Range.create(0, 1, 0, 2))).toBe(true)
    expect(rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 1, 0, 2))).toBe(false)
    expect(rangeOverlap(Range.create(0, 1, 0, 2), Range.create(0, 0, 0, 1))).toBe(false)
    expect(rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 2, 0, 3))).toBe(false)
  })

  test('positionInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positionInRange(pos, r)).toBe(0)
  })

  test('comparePosition', () => {
    let pos = Position.create(0, 0)
    expect(comparePosition(pos, pos)).toBe(0)
  })

  test('isSingleLine', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(isSingleLine(r)).toBe(true)
  })

  test('getChangedPosition #1', () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'abc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 0, character: 3 })
  })

  test('getChangedPosition #2', () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'a\nb\nc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: 1 })
  })

  test('getChangedPosition #3', () => {
    let pos = Position.create(0, 1)
    let r = Range.create(addPosition(pos, 0, -1), pos)
    let edit = TextEdit.replace(r, 'a\nb\n')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: -1 })
  })
})

describe('match result', () => {
  it('should match empty text', async () => {
    expect(getMatchResult('', 'foo')).toEqual({ score: 0 })
  })

  it('should match empty query', async () => {
    expect(getMatchResult('foo', '')).toEqual({ score: 1 })
  })

  it('should respect filename #1', () => {
    let res = getMatchResult('/coc.nvim/coc.txt', 'coc', 'coc.txt')
    expect(res).toEqual({ score: 4, matches: [10, 11, 12] })
  })

  it('should respect filename #2', () => {
    let res = getMatchResult('/coc.nvim/Coc.txt', 'coc', 'Coc.txt')
    expect(res).toEqual({ score: 3.5, matches: [10, 11, 12] })
  })

  it('should respect filename #3', () => {
    let res = getMatchResult('/coc.nvim/cdoxc.txt', 'coc', 'cdoxc.txt')
    expect(res).toEqual({ score: 3, matches: [10, 12, 14] })
  })

  it('should respect filename #4', () => {
    let res = getMatchResult('/coc.nvim/fileName.txt', 'namt', 'fileName.txt')
    expect(res).toEqual({ score: 3.5, matches: [14, 15, 16, 19] })
  })

  it('should respect path start', () => {
    let res = getMatchResult('/foob/baxr/xyz', 'fbx')
    expect(res).toEqual({ score: 3, matches: [1, 6, 11] })
  })

  it('should find fuzzy result', () => {
    let res = getMatchResult('foobarzyx', 'fbx')
    expect(res).toEqual({ score: 2, matches: [0, 3, 8] })
  })

  it('should find fuzzy result #1', () => {
    let res = getMatchResult('LICENSES/preferred/MIT', 'lsit')
    expect(res).toEqual({ score: 1.4, matches: [0, 5, 20, 21] })
  })
})

describe('utility', () => {

  it('should not throw for invalid ms', async () => {
    await wait(-1)
  })

  it('should get uri for unknown buftype', async () => {
    let res = getUri('foo', 3, '', false)
    expect(res).toBe('unknown:3')
  })

  it('should watch file', async () => {
    let filepath = await createTmpFile('my file')
    let fn = jest.fn()
    let disposable = watchFile(filepath, () => {
      fn()
    })
    await wait(10)
    fs.writeFileSync(filepath, 'new file', 'utf8')
    await wait(200)
    expect(fn).toBeCalled()
    disposable.dispose()
  })

  it('should check executable', async () => {
    let res = executable('command_not_exists')
    expect(res).toBe(false)
  })

  it('should check isRunning', async () => {
    expect(isRunning(process.pid)).toBe(true)
  })

  it('should run command with timeout', async () => {
    let err
    try {
      await runCommand('sleep 2', { cwd: __dirname }, 0.01)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw on command error', async () => {
    let err
    try {
      await runCommand('command_not_exists', { cwd: __dirname })
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should resolve concurrent with empty task', async () => {
    let fn = jest.fn()
    await concurrent([], fn, 3)
    expect(fn).toBeCalledTimes(0)
  })

  it('should run concurrent', async () => {
    let res: number[] = []
    let fn = (n: number): Promise<void> => {
      return new Promise(resolve => {
        setTimeout(() => {
          res.push(n)
          resolve()
        }, n * 10)
      })
    }
    let arr = [5, 4, 3, 6, 8]
    let ts = Date.now()
    await concurrent(arr, fn, 3)
    let dt = Date.now() - ts
    expect(dt).toBeLessThanOrEqual(130)
    expect(dt).toBeGreaterThanOrEqual(100)
    expect(res).toEqual([3, 4, 5, 6, 8])
  })

  it('should getKeymapModifier', async () => {
    expect(getKeymapModifier('i')).toBe('<C-o>')
    expect(getKeymapModifier('s')).toBe('<Esc>')
    expect(getKeymapModifier('x')).toBe('<C-U>')
    expect(getKeymapModifier('t' as any)).toBe('')
  })
})

describe('score test', () => {

  it('fzy#score', async () => {
    let a = score("amuser", "app/models/user.rb")
    let b = score("amuser", "app/models/customer.rb")
    expect(a).toBeGreaterThan(b)
  })

  it('fzy#positions', async () => {
    let arr = positions("amuser", "app/models/user.rb")
    expect(arr).toEqual([0, 4, 11, 12, 13, 14])
  })

  it('fzy#groupPositions', async () => {
    let arr = groupPositions([1, 2, 3, 6, 7, 10])
    expect(arr).toEqual([[1, 4], [6, 8], [10, 11]])
  })
})

describe('fuzzy match test', () => {
  it('should be fuzzy match', () => {
    let needle = 'aBc'
    let codes = getCharCodes(needle)
    expect(fuzzyMatch(codes, 'abc')).toBeFalsy
    expect(fuzzyMatch(codes, 'ab')).toBeFalsy
    expect(fuzzyMatch(codes, 'addbdd')).toBeFalsy
    expect(fuzzyMatch(codes, 'abbbBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'daBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'ABCz')).toBeTruthy
  })

  it('should be fuzzy for character', () => {
    expect(fuzzyChar('a', 'a')).toBeTruthy
    expect(fuzzyChar('a', 'A')).toBeTruthy
    expect(fuzzyChar('z', 'z')).toBeTruthy
    expect(fuzzyChar('z', 'Z')).toBeTruthy
    expect(fuzzyChar('A', 'a')).toBeFalsy
    expect(fuzzyChar('A', 'A')).toBeTruthy
    expect(fuzzyChar('Z', 'z')).toBeFalsy
    expect(fuzzyChar('Z', 'Z')).toBeTruthy
  })
})

describe('object test', () => {
  it('mixin should recursive', () => {
    let res = objects.mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 })
    expect(res.a.b).toBe(1)
    expect(res.a.c).toBe(2)
    expect(res.d).toBe(3)
    res = objects.mixin({}, true)
    expect(res).toEqual({})
    res = objects.mixin({ x: 1 }, { x: 2 }, false)
    expect(res).toEqual({ x: 1 })
  })

  it('should deep clone', async () => {
    let re = new RegExp('a', 'g')
    expect(objects.deepClone(re)).toBe(re)
  })

  it('should not deep freeze', async () => {
    objects.deepFreeze(false)
    objects.deepFreeze(true)
  })

  it('should check equals', async () => {
    expect(objects.equals(false, 1)).toBe(false)
    expect(objects.equals([1], {})).toBe(false)
    expect(objects.equals([1, 2], [1, 3])).toBe(false)
  })

  it('should check empty object', async () => {
    expect(objects.isEmpty({})).toBe(true)
    expect(objects.isEmpty([])).toBe(true)
    expect(objects.isEmpty(null)).toBe(true)
    expect(objects.isEmpty({ x: 1 })).toBe(false)
  })
})

describe('ansiparse', () => {
  it('ansiparse #1', () => {
    let str = '\u001b[33mText\u001b[mnormal'
    let res = ansiparse(str)
    expect(res).toEqual([{
      foreground: 'yellow', text: 'Text'
    }, {
      text: 'normal'
    }])
  })

  it('ansiparse #2', () => {
    let str = '\u001b[33m\u001b[mText'
    let res = ansiparse(str)
    expect(res).toEqual([
      { foreground: 'yellow', text: '' },
      { text: 'Text' }])
  })

  it('ansiparse #3', () => {
    let str = 'this.\u001b[0m\u001b[31m\u001b[1mhistory\u001b[0m.add()'
    let res = ansiparse(str)
    expect(res[1]).toEqual({
      foreground: 'red',
      bold: true, text: 'history'
    })
  })
})

describe('Mutex', () => {
  it('mutex run in serial', async () => {
    let lastTs: number
    let fn = () => new Promise<void>(resolve => {
      if (lastTs) {
        let dt = Date.now() - lastTs
        expect(dt).toBeGreaterThanOrEqual(2)
      }
      lastTs = Date.now()
      setTimeout(() => {
        resolve()
      }, 3)
    })
    let mutex = new Mutex()
    await Promise.all([
      mutex.use(fn),
      mutex.use(fn),
      mutex.use(fn)
    ])
  })

  it('mutex run after job finish', async () => {
    let count = 0
    let fn = () => new Promise<void>(resolve => {
      count = count + 1
      setTimeout(() => {
        resolve()
      }, 10)
    })
    let mutex = new Mutex()
    await mutex.use(fn)
    await helper.wait(1)
    await mutex.use(fn)
    expect(count).toBe(2)
  })

  it('should release on reject', async () => {
    let mutex = new Mutex()
    let err
    try {
      await mutex.use(() => {
        return Promise.reject(new Error('err'))
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(mutex.busy).toBe(false)
  })
})

describe('terminate', () => {
  it('should terminate process', async () => {
    let cwd = process.cwd()
    let child = spawn('sleep', ['10'], { cwd, detached: true })
    let res = terminate(child, cwd)
    await helper.wait(60)
    expect(res).toBe(true)
    expect(child.connected).toBe(false)
    terminate(child, cwd)
  })
})

describe('diff', () => {
  describe('diff lines', () => {
    function diff(oldStr: string, newStr: string): ChangedLines {
      let oldLines = oldStr.split('\n')
      return diffLines(oldLines, newStr.split('\n'), oldLines.length - 2)
    }

    it('should diff changed lines', () => {
      let res = diff('a\n', 'b\n')
      expect(res).toEqual({ start: 0, end: 1, replacement: ['b'] })
    })

    it('should diff added lines', () => {
      let res = diff('a\n', 'a\nb\n')
      expect(res).toEqual({
        start: 1,
        end: 1,
        replacement: ['b']
      })
    })

    it('should diff remove lines', () => {
      let res = diff('a\n\n', 'a\n')
      expect(res).toEqual({
        start: 1,
        end: 2,
        replacement: []
      })
    })

    it('should diff remove multiple lines', () => {
      let res = diff('a\n\n\n', 'a\n')
      expect(res).toEqual({
        start: 1,
        end: 3,
        replacement: []
      })
    })

    it('should diff removed line', () => {
      let res = diff('a\n\n\nb', 'a\n\nb')
      expect(res).toEqual({
        start: 2,
        end: 3,
        replacement: []
      })
    })

    it('should reduce changed lines', async () => {
      let res = diffLines(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 0)
      expect(res).toEqual({
        start: 3,
        end: 3,
        replacement: ['d']
      })
    })
  })

  describe('patch line', () => {
    it('should patch line', () => {
      let res = patchLine('foo', 'bar foo bar')
      expect(res.length).toBe(7)
      expect(res).toBe('    foo')
    })
  })

  describe('should get text edits', () => {

    function applyEdits(oldStr: string, newStr: string): void {
      let doc = TextDocument.create('untitled://1', 'markdown', 0, oldStr)
      let change = getChange(doc.getText(), newStr)
      let start = doc.positionAt(change.start)
      let end = doc.positionAt(change.end)
      let edit: TextEdit = {
        range: { start, end },
        newText: change.newText
      }
      let res = TextDocument.applyEdits(doc, [edit])
      expect(res).toBe(newStr)
    }

    it('should get diff for comments ', async () => {
      let oldStr = '/*\n *\n * \n'
      let newStr = '/*\n *\n *\n * \n'
      let doc = TextDocument.create('untitled://1', 'markdown', 0, oldStr)
      let change = getChange(doc.getText(), newStr, 1)
      let start = doc.positionAt(change.start)
      let end = doc.positionAt(change.end)
      let edit: TextEdit = {
        range: { start, end },
        newText: change.newText
      }
      let res = TextDocument.applyEdits(doc, [edit])
      expect(res).toBe(newStr)
    })

    it('should return null for same content', () => {
      let change = getChange('', '')
      expect(change).toBeNull()
      change = getChange('abc', 'abc')
      expect(change).toBeNull()
    })

    it('should get diff for added', () => {
      applyEdits('1\n2', '1\n2\n3\n4')
    })

    it('should get diff for added #0', () => {
      applyEdits('\n\n', '\n\n\n')
    })

    it('should get diff for added #1', () => {
      applyEdits('1\n2\n3', '5\n1\n2\n3')
    })

    it('should get diff for added #2', () => {
      applyEdits('1\n2\n3', '1\n2\n4\n3')
    })

    it('should get diff for added #3', () => {
      applyEdits('1\n2\n3', '4\n1\n2\n3\n5')
    })

    it('should get diff for added #4', () => {
      applyEdits(' ', '   ')
    })

    it('should get diff for replace', () => {
      applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
    })

    it('should get diff for replace #1', () => {
      applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
    })

    it('should get diff for remove #0', () => {
      applyEdits('1\n2\n3\n4', '1\n4')
    })

    it('should get diff for remove #1', () => {
      applyEdits('1\n2\n3\n4', '1')
    })

    it('should get diff for remove #2', () => {
      applyEdits('  ', ' ')
    })

    it('should prefer cursor position for change', async () => {
      let res = getChange(' int n', ' n', 0)
      expect(res).toEqual({ start: 1, end: 5, newText: '' })
      res = getChange(' int n', ' n')
      expect(res).toEqual({ start: 0, end: 4, newText: '' })
    })

    it('should prefer next line for change', async () => {
      let res = getChange('a\nb', 'a\nc\nb')
      expect(res).toEqual({ start: 2, end: 2, newText: 'c\n' })
      applyEdits('a\nb', 'a\nc\nb')
    })

    it('should prefer previous line for change', async () => {
      let res = getChange('\n\na', '\na')
      expect(res).toEqual({ start: 0, end: 1, newText: '' })
    })

    it('should consider cursor', () => {
      let res = getChange('\n\n\n', '\n\n\n\n', 1)
      expect(res).toEqual({ start: 2, end: 2, newText: '\n' })
    })

    it('should get minimal diff', () => {
      let res = getChange('foo\nbar', 'fab\nbar', 2)
      expect(res).toEqual({ start: 1, end: 3, newText: 'ab' })
    })
  })
})
