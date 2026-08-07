'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  lineWindow,
  readDiskText,
  readDiskWindow,
  toTextEdits,
  windowToRangeText
} from '../../mcp/tools/document'

describe('mcp document helpers', () => {
  let tmpdir: string
  let file: string

  beforeAll(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-document-helpers-'))
    file = path.join(tmpdir, 'sample.txt')
    fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
  })

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true })
  })

  it('reads complete files and reports disk errors', () => {
    expect(readDiskText(URI.file(file).toString()).text).toBe('alpha\nbeta\ngamma\n')
    let missing = readDiskText(URI.file(path.join(tmpdir, 'missing.txt')).toString())
    expect(missing.text).toBe('')
    expect(missing.error).toBeTruthy()
  })

  it('reads line windows and reports disk errors', async () => {
    expect((await readDiskWindow(URI.file(file).toString(), 1, 3)).lines).toEqual(['beta', 'gamma'])
    let missing = await readDiskWindow(URI.file(path.join(tmpdir, 'missing.txt')).toString(), 0, 1)
    expect(missing.lines).toEqual([])
    expect(missing.error).toBeTruthy()
  })

  it('reconstructs empty, single-line and multiline ranges', () => {
    expect(windowToRangeText([], Range.create(0, 0, 0, 0))).toBe('')
    expect(windowToRangeText(['abcdef'], Range.create(0, 1, 0, 4))).toBe('bcd')
    expect(windowToRangeText(['abc', 'def'], Range.create(0, 1, 1, 2))).toBe('bc\nde')
    expect(windowToRangeText(['abc', 'middle', 'def'], Range.create(0, 1, 2, 2))).toBe('bc\nmiddle\nde')
  })

  it('reads normalized line windows from documents', () => {
    let doc = {
      lineCount: 3,
      getLines: (start: number, end: number) => ['zero', 'one', 'two'].slice(start, end)
    } as any
    expect(lineWindow(doc, undefined, undefined)).toBe('zero\none\ntwo')
    expect(lineWindow(doc, -5, 2)).toBe('zero\none')
    expect(lineWindow(doc, 2, 2)).toBe('')
  })

  it('validates and converts text edits', () => {
    let args = {
      edits: [{
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
        newText: 'x'
      }]
    }
    expect(toTextEdits(args)).toEqual([{ range: Range.create(0, 1, 0, 2), newText: 'x' }])
    for (let edits of [
      undefined,
      [],
      [null],
      ['edit'],
      [{}],
      [{ range: {}, newText: 'x' }],
      [{ range: { start: {}, end: { line: 0, character: 0 } }, newText: 'x' }],
      [{ range: { start: { line: 0, character: 0 }, end: {} }, newText: 'x' }],
      [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 1 }]
    ]) {
      expect(toTextEdits({ edits })).toBeNull()
    }
  })
})
