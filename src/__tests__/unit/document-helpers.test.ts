'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import {
  lineWindow,
  readDiskText,
  readDiskWindow,
  toTextEdits,
  windowToRangeText
} from '../../mcp/tools/document'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('mcp document helpers', () => {
  let tmpdir: string
  let file: string

  before(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-document-helpers-'))
    file = path.join(tmpdir, 'sample.txt')
    fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
  })

  after(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true })
  })

  it('reads complete files and reports disk errors', () => {
    assert.strictEqual(readDiskText(URI.file(file).toString()).text, 'alpha\nbeta\ngamma\n')
    let missing = readDiskText(URI.file(path.join(tmpdir, 'missing.txt')).toString())
    assert.strictEqual(missing.text, '')
    assert.ok(missing.error)
  })

  it('reads line windows and reports disk errors', async () => {
    assert.deepStrictEqual((await readDiskWindow(URI.file(file).toString(), 1, 3)).lines, ['beta', 'gamma'])
    let missing = await readDiskWindow(URI.file(path.join(tmpdir, 'missing.txt')).toString(), 0, 1)
    assert.deepStrictEqual(missing.lines, [])
    assert.ok(missing.error)
  })

  it('reconstructs empty, single-line and multiline ranges', () => {
    assert.strictEqual(windowToRangeText([], Range.create(0, 0, 0, 0)), '')
    assert.strictEqual(windowToRangeText(['abcdef'], Range.create(0, 1, 0, 4)), 'bcd')
    assert.strictEqual(windowToRangeText(['abc', 'def'], Range.create(0, 1, 1, 2)), 'bc\nde')
    assert.strictEqual(windowToRangeText(['abc', 'middle', 'def'], Range.create(0, 1, 2, 2)), 'bc\nmiddle\nde')
  })

  it('reads normalized line windows from documents', () => {
    let doc = {
      lineCount: 3,
      getLines: (start: number, end: number) => ['zero', 'one', 'two'].slice(start, end)
    } as any
    assert.strictEqual(lineWindow(doc, undefined, undefined), 'zero\none\ntwo')
    assert.strictEqual(lineWindow(doc, -5, 2), 'zero\none')
    assert.strictEqual(lineWindow(doc, 2, 2), '')
  })

  it('validates and converts text edits', () => {
    let args = {
      edits: [{
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
        newText: 'x'
      }]
    }
    assert.deepStrictEqual(toTextEdits(args), [{ range: Range.create(0, 1, 0, 2), newText: 'x' }])
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
      assert.strictEqual(toTextEdits({ edits }), null)
    }
  })
})
