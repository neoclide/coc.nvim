import path from 'path'
import { URI } from 'vscode-uri'
import os from 'os'
import { isGitIgnored, findUp, resolveRoot, statAsync, parentDirs, isParentFolder } from '../../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { score, positions } from '../../util/fzy'
import { score as matchScore } from '../../util/match'
import { mixin } from '../../util/object'
import { Mutex } from '../../util/mutex'
import { indexOf } from '../../util/string'
import helper from '../helper'
import { ansiparse } from '../../util/ansiparse'
import { concurrent } from '../../util'

describe('score test', () => {
  test('should match schema', () => {
    let uri = URI.file('/foo').toString()
    let s = matchScore([{ language: '*', scheme: 'file' }], uri, 'typescript')
    expect(s).toBe(5)
  })

  test('fzy#score', async () => {
    let a = score("amuser", "app/models/user.rb")
    let b = score("amuser", "app/models/customer.rb")
    expect(a).toBeGreaterThan(b)
  })

  test('fzy#positions', async () => {
    let arr = positions("amuser", "app/models/user.rb")
    expect(arr).toEqual([0, 4, 11, 12, 13, 14])
  })
})

describe('parentDirs', () => {
  test('get parentDirs', () => {
    let dirs = parentDirs('/a/b/c')
    expect(dirs).toEqual(['/', '/a', '/a/b'])
  })
})

describe('isParentFolder', () => {
  test('check parent folder', () => {
    expect(isParentFolder('/a', '/a/b')).toBe(true)
    expect(isParentFolder('/a/b', '/a/b/')).toBe(false)
    expect(isParentFolder('/a/b', '/a/b')).toBe(false)
    expect(isParentFolder('/a/b', '/a/b', true)).toBe(true)
  })
})

describe('string test', () => {
  test('should find index', () => {
    expect(indexOf('a,b,c', ',', 2)).toBe(3)
    expect(indexOf('a,b,c', ',', 1)).toBe(1)
  })
})

describe('concurrent', () => {
  test('should run concurrent', async () => {
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
  test('should be fuzzy match', () => {
    let needle = 'aBc'
    let codes = getCharCodes(needle)
    expect(fuzzyMatch(codes, 'abc')).toBeFalsy
    expect(fuzzyMatch(codes, 'ab')).toBeFalsy
    expect(fuzzyMatch(codes, 'addbdd')).toBeFalsy
    expect(fuzzyMatch(codes, 'abbbBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'daBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'ABCz')).toBeTruthy
  })

  test('should be fuzzy for character', () => {
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
  test('fs statAsync', async () => {
    let res = await statAsync(__filename)
    expect(res).toBeDefined
    expect(res.isFile()).toBe(true)
  })

  test('fs statAsync #1', async () => {
    let res = await statAsync(path.join(__dirname, 'file_not_exist'))
    expect(res).toBeNull
  })

  test('should be not ignored', async () => {
    let res = await isGitIgnored(__filename)
    expect(res).toBeFalsy
  })

  test('should be ignored', async () => {
    let res = await isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'))
    expect(res).toBeTruthy
  })
})

describe('object test', () => {
  test('mixin should recursive', () => {
    let res = mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 })
    expect(res.a.b).toBe(1)
    expect(res.a.c).toBe(2)
    expect(res.d).toBe(3)
  })
})

describe('resolveRoot', () => {
  test('resolve root consider root path', () => {
    let res = resolveRoot(__dirname, ['.git'])
    expect(res).toMatch('coc.nvim')
  })

  test('should resolve from parent folders', () => {
    let root = path.resolve(__dirname, '../extensions/snippet-sample')
    let res = resolveRoot(root, ['package.json'])
    expect(res.endsWith('coc.nvim')).toBe(true)
  })

  test('should not resolve to home', () => {
    let res = resolveRoot(__dirname, ['.config'])
    expect(res != os.homedir()).toBeTruthy()
  })
})

describe('findUp', () => {
  test('findUp by filename', () => {
    let filepath = findUp('package.json', __dirname)
    expect(filepath).toMatch('coc.nvim')
    filepath = findUp('not_exists', __dirname)
    expect(filepath).toBeNull()
  })

  test('findUp by filenames', async () => {
    let filepath = findUp(['src'], __dirname)
    expect(filepath).toMatch('coc.nvim')
  })
})

describe('ansiparse', () => {
  test('ansiparse #1', () => {
    let str = '\u001b[33mText\u001b[mnormal'
    let res = ansiparse(str)
    expect(res).toEqual([{
      foreground: 'yellow', text: 'Text'
    }, {
      text: 'normal'
    }])
  })

  test('ansiparse #2', () => {
    let str = '\u001b[33m\u001b[mText'
    let res = ansiparse(str)
    expect(res).toEqual([
      { foreground: 'yellow', text: '' },
      { text: 'Text' }])
  })

  test('ansiparse #3', () => {
    let str = 'this.\u001b[0m\u001b[31m\u001b[1mhistory\u001b[0m.add()'
    let res = ansiparse(str)
    expect(res[1]).toEqual({
      foreground: 'red',
      bold: true, text: 'history'
    })
  })
})

describe('Mutex', () => {
  test('mutex run in serial', async () => {
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

  test('mutex run after job finish', async () => {
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
