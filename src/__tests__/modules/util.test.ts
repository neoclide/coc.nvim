/* tslint:disable:no-console */
import { TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { getChange } from '../../util/diff'
import { createTmpFile, isGitIgnored, readFileByLine, statAsync } from '../../util/fs'
import { fuzzyChar, fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import { score } from '../../util/match'
import Uri from 'vscode-uri'
import path = require('path')
import fs = require('fs')

describe('score test', () => {
  test('should match schema', () => {
    let uri = Uri.file('/foo').toString()
    let s = score([{ language: '*', scheme: 'file' }], uri, 'typescript')
    expect(s).toBe(5)
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

  test('should read file by line', async () => {
    let lines = []
    await readFileByLine(__filename, line => {
      lines.push(line)
    })
    expect(lines.length > 0).toBeTruthy
  })

  test('should create tmp file', async () => {
    let filename = await createTmpFile('coc test')
    expect(typeof filename).toBe('string')
    let stat = fs.statSync(filename)
    expect(stat.isFile()).toBeTruthy
  })
})

describe('diff test', () => {

  function expectChange(from: string, to: string): void {
    let doc = TextDocument.create('/coc', 'text', 0, from)
    let change = getChange(from, to)
    let { newText } = change
    let start = doc.positionAt(change.start)
    let end = doc.positionAt(change.end)
    let edit: TextEdit = {
      range: { start, end },
      newText
    }
    let newContent = TextDocument.applyEdits(doc, [edit])
    expect(newContent).toBe(to)
  }

  test('should get change', () => {
    expectChange('a', 'b')
    expectChange('a', 'bb')
    expectChange('abc\ndef', 'abbc\ndf')
    let arr = new Array(100000)
    let content = arr.fill('a').join('\n')
    expectChange(content, '')
    expectChange('', content)
    expectChange('abc', 'abbc\ndf')
  })
})
