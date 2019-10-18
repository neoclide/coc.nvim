/* tslint:disable:no-console */
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import rimraf from 'rimraf'
import { URI } from 'vscode-uri'
import os from 'os'
import { mkdirp } from '../../util'
import { isGitIgnored, findUp, resolveRoot, statAsync, parentDirs, isParentFolder } from '../../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { score, positions } from '../../util/fzy'
import { getHiglights } from '../../util/highlight'
import { score as matchScore } from '../../util/match'
import { mixin } from '../../util/object'
import { indexOf, resolveVariables } from '../../util/string'
import helper from '../helper'
import { ansiparse } from '../../util/ansiparse'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

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

describe('mkdirp', () => {
  test('should mkdirp', async () => {
    let dir = path.join(__dirname, 'a/b/c')
    let res = await mkdirp(dir)
    expect(res).toBe(true)
    rimraf.sync(path.join(__dirname, 'a'))
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

  test('resolve variables', async () => {
    let res = resolveVariables('${workspace}/foo', { workspace: '/home' })
    expect(res).toBe('/home/foo')
    expect(resolveVariables('${x}', {})).toBe('${x}')
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

describe('getHiglights', () => {
  test('getHiglights', async () => {
    let res = await getHiglights([
      '*@param* `buffer`'
    ], 'markdown')
    expect(res.length > 0).toBe(true)
    for (let filetype of ['Error', 'Warning', 'Info', 'Hint']) {
      let res = await getHiglights(['foo'], filetype)
      expect(res.length > 0).toBe(true)
    }
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
