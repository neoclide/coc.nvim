import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Range, Position, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { concurrent, wait, watchFile } from '../../util'
import { ansiparse } from '../../util/ansiparse'
import { ChangedLines, diffLines, getChange, patchLine } from '../../util/diff'
import { findUp, isGitIgnored, isParentFolder, parentDirs, resolveRoot, statAsync } from '../../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { groupPositions, positions, score } from '../../util/fzy'
import { Mutex } from '../../util/mutex'
import { mixin } from '../../util/object'
import { terminate } from '../../util/processes'
import { getMatchResult } from '../../util/score'
import { indexOf, rangeParts } from '../../util/string'
import { rangeInRange, positionInRange, comparePosition, isSingleLine, getChangedPosition, rangeOverlap } from '../../util/position'
import * as assert from 'assert'
import * as arrays from '../../util/array'
import helper, { createTmpFile } from '../helper'

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

describe('match result', () => {
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

describe('rangeParts', () => {
  it('should get parts', async () => {
    let res = rangeParts('foo bar', Range.create(0, 0, 0, 4))
    expect(res).toEqual(['', 'bar'])
    res = rangeParts('foo\nbar', Range.create(0, 1, 1, 1))
    expect(res).toEqual(['f', 'ar'])
    res = rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 2, 3))
    expect(res).toEqual(['x', '\ny'])
  })
})

describe('watchFile', () => {
  it('should watch file', async () => {
    let filepath = await createTmpFile('my file')
    let fn = jest.fn()
    let disposable = watchFile(filepath, () => {
      fn()
    })
    await wait(50)
    fs.writeFileSync(filepath, 'new file', 'utf8')
    await wait(200)
    expect(fn).toBeCalled()
    disposable.dispose()
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

describe('parentDirs', () => {
  it('get parentDirs', () => {
    let dirs = parentDirs('/a/b/c')
    expect(dirs).toEqual(['/', '/a', '/a/b'])
  })
})

describe('isParentFolder', () => {
  it('check parent folder', () => {
    expect(isParentFolder('/a', '/a/b')).toBe(true)
    expect(isParentFolder('/a/b', '/a/b/')).toBe(false)
    expect(isParentFolder('/a/b', '/a/b')).toBe(false)
    expect(isParentFolder('/a/b', '/a/b', true)).toBe(true)
  })
})

describe('string test', () => {
  it('should find index', () => {
    expect(indexOf('a,b,c', ',', 2)).toBe(3)
    expect(indexOf('a,b,c', ',', 1)).toBe(1)
  })
})

describe('concurrent', () => {
  it('should run concurrent', async () => {
    let res: number[] = []
    let fn = (n: number): Promise<void> => {
      return new Promise(resolve => {
        setTimeout(() => {
          res.push(n)
          resolve()
        }, n * 100)
      })
    }
    let arr = [5, 4, 3, 6, 8]
    let ts = Date.now()
    await concurrent(arr, fn, 3)
    let dt = Date.now() - ts
    expect(dt).toBeLessThanOrEqual(1300)
    expect(dt).toBeGreaterThanOrEqual(1200)
    expect(res).toEqual([3, 4, 5, 6, 8])
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

describe('fs test', () => {
  it('fs statAsync', async () => {
    let res = await statAsync(__filename)
    expect(res).toBeDefined
    expect(res.isFile()).toBe(true)
  })

  it('fs statAsync #1', async () => {
    let res = await statAsync(path.join(__dirname, 'file_not_exist'))
    expect(res).toBeNull
  })

  it('should be not ignored', async () => {
    let res = await isGitIgnored(__filename)
    expect(res).toBeFalsy
  })

  it('should be ignored', async () => {
    let res = await isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'))
    expect(res).toBeTruthy
  })
})

describe('object test', () => {
  it('mixin should recursive', () => {
    let res = mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 })
    expect(res.a.b).toBe(1)
    expect(res.a.c).toBe(2)
    expect(res.d).toBe(3)
  })
})

describe('resolveRoot', () => {
  it('resolve root consider root path', () => {
    let res = resolveRoot(__dirname, ['.git'])
    expect(res).toMatch('coc.nvim')
  })

  it('should resolve from parent folders', () => {
    let root = path.resolve(__dirname, '../extensions/snippet-sample')
    let res = resolveRoot(root, ['package.json'])
    expect(res.endsWith('coc.nvim')).toBe(true)
  })

  it('should resolve from parent folders with bottom-up method', () => {
    let root = path.resolve(__dirname, '../extensions/snippet-sample')
    let res = resolveRoot(root, ['package.json'], null, true)
    expect(res.endsWith('extensions')).toBe(true)
  })

  it('should resolve to cwd', () => {
    let root = path.resolve(__dirname, '../extensions/test/')
    let res = resolveRoot(root, ['package.json'], root, false, true)
    expect(res).toBe(root)
  })

  it('should resolve to root', () => {
    let root = path.resolve(__dirname, '../extensions/test/')
    let res = resolveRoot(root, ['package.json'], root, false, false)
    expect(res).toBe(path.resolve(__dirname, '../../../'))
  })

  it('should not resolve to home', () => {
    let res = resolveRoot(__dirname, ['.config'], undefined, false, false, [os.homedir()])
    expect(res != os.homedir()).toBeTruthy()
  })
})

describe('findUp', () => {
  it('findUp by filename', () => {
    let filepath = findUp('package.json', __dirname)
    expect(filepath).toMatch('coc.nvim')
    filepath = findUp('not_exists', __dirname)
    expect(filepath).toBeNull()
  })

  it('findUp by filenames', async () => {
    let filepath = findUp(['src'], __dirname)
    expect(filepath).toMatch('coc.nvim')
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
        expect(dt).toBeGreaterThanOrEqual(298)
      }
      lastTs = Date.now()
      setTimeout(() => {
        resolve()
      }, 300)
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
      }, 100)
    })
    let mutex = new Mutex()
    await mutex.use(fn)
    await helper.wait(10)
    await mutex.use(fn)
    expect(count).toBe(2)
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
  })
})
