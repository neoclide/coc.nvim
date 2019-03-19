/* tslint:disable:no-console */
import path from 'path'
import Uri from 'vscode-uri'
import { isGitIgnored, resolveRoot, statAsync } from '../../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { score } from '../../util/match'
import { mixin } from '../../util/object'
import { indexOf } from '../../util/string'
import { getHiglights } from '../../util/highlight'
import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'

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
    let uri = Uri.file('/foo').toString()
    let s = score([{ language: '*', scheme: 'file' }], uri, 'typescript')
    expect(s).toBe(5)
  })
})

describe('string test', () => {
  test('should find index', () => {
    expect(indexOf('a,b,c', ',', 2)).toBe(3)
    expect(indexOf('a,b,c', ',', 1)).toBe(1)
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
    let res = resolveRoot('/usr', ['.git'])
    expect(res).toBe('/usr')
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
