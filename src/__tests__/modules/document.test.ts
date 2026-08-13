import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import Document, { getNotAttachReason, getUri } from '../../model/document'
import { uriToFsPath } from '../../util/fs'
import { computeLinesOffsets, firstDiffLine, LinesTextDocument } from '../../model/textdocument'
import { Disposable, disposeAll } from '../../util'
import { applyEdits, filterSortEdits } from '../../util/textedit'
import events from '../../events'
import workspace from '../../workspace'

let nvim: Neovim

function createTextDocument(lines: string[], eol = true): LinesTextDocument {
  return new LinesTextDocument('file://a', 'txt', 1, lines, 1, eol)
}

async function setLines(doc: Document, lines: string[]): Promise<void> {
  let edit = TextEdit.insert(Position.create(0, 0), lines.join('\n'))
  await doc.applyEdits([edit])
}

describe('LinesTextDocument', () => {
  it('should get first diff line', async t => {
    {
      let res = firstDiffLine(['a', 'b'], ['a', 'b'])
      assert.strictEqual(res, undefined)
    }
    {
      let res = firstDiffLine(['a', 'c'], ['a', 'b'])
      assert.deepStrictEqual(res, [2, 'c', 'b'])
    }
    {
      let res = firstDiffLine(['a'], ['a', 'b'])
      assert.deepStrictEqual(res, [2, '', 'b'])
    }
    {
      let res = firstDiffLine(['a', 'b'], ['a'])
      assert.deepStrictEqual(res, [2, 'b', ''])
    }
  })

  it('should apply edits', t => {
    let textDocument = new LinesTextDocument('', '', 1, [
      'use std::io::Result;'
    ], 1, true)
    // 1234567890
    let edits = [
      { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } }, newText: "" },
      { range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } }, newText: "io" },
      { range: { start: { line: 0, character: 19 }, end: { line: 0, character: 19 } }, newText: "::" },
      {
        range: { start: { line: 0, character: 19 }, end: { line: 0, character: 19 } }, newText: "{Result, Error}"
      }
    ]
    edits = filterSortEdits(textDocument, edits)
    let res = applyEdits(textDocument, edits)
    assert.deepStrictEqual(res, ['use std::io::{Result, Error};'])
    textDocument = new LinesTextDocument('', '', 1, [''], 1, true)
    res = applyEdits(textDocument, [TextEdit.replace(Range.create(0, 0, 1, 0), '')])
    assert.deepStrictEqual(res, [''])
  })

  it('should throw for overlapping edits', t => {
    let textDocument = new LinesTextDocument('', '', 1, [
      'use std::io::Result;'
    ], 1, true)
    let edits = [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: "foo" },
      { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, newText: "new" }
    ]
    assert.throws(() => {
      applyEdits(textDocument, edits)
    })
  })

  it('should return undefined when not changed', t => {
    let textDocument = new LinesTextDocument('', '', 1, [
      'foo bar'
    ], 1, true)
    let edits = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "f" },
      { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: "o" }
    ]
    let res = applyEdits(textDocument, edits)
    assert.strictEqual(res, undefined)
  })

  it('should get length', t => {
    let doc = createTextDocument(['foo'])
    assert.strictEqual(doc.length, 4)
    assert.strictEqual(doc.getText().length, 4)
    assert.strictEqual(doc.length, 4)
    doc = createTextDocument(['foo'], false)
    assert.strictEqual(doc.length, 3)
  })

  it('should getText by range', t => {
    let doc = createTextDocument(['foo', 'bar'])
    assert.strictEqual(doc.getText(Range.create(0, 0, 0, 1)), 'f')
    assert.strictEqual(doc.getText(Range.create(0, 0, 1, 0)), 'foo\n')
  })

  it('should get positionAt', t => {
    let doc = createTextDocument([], false)
    assert.deepStrictEqual(doc.positionAt(0), Position.create(0, 0))
  })

  it('should get offsetAt', t => {
    let doc = createTextDocument([''], false)
    assert.strictEqual(doc.offsetAt(Position.create(1, 0)), 0)
    assert.strictEqual(doc.offsetAt({ line: -1, character: -1 }), 0)
  })

  it('should work when eol enabled', t => {
    let doc = createTextDocument(['foo', 'bar'])
    assert.strictEqual(doc.lineCount, 3)
    let content = doc.getText()
    assert.strictEqual(content, 'foo\nbar\n')
    content = doc.getText(Range.create(0, 0, 0, 3))
    assert.strictEqual(content, 'foo')
    let textLine = doc.lineAt(0)
    assert.strictEqual(textLine.text, 'foo')
    textLine = doc.lineAt(Position.create(0, 3))
    assert.strictEqual(textLine.text, 'foo')
    let pos = doc.positionAt(4)
    assert.deepStrictEqual(pos, { line: 1, character: 0 })
    content = doc.getText(Range.create(0, 0, 0, 3))
    assert.strictEqual(content, 'foo')
    let offset = doc.offsetAt(Position.create(0, 4))
    assert.strictEqual(offset, 4)
    offset = doc.offsetAt(Position.create(2, 1))
    assert.strictEqual(offset, 8)
    assert.deepStrictEqual(doc.end, Position.create(2, 0))
  })

  it('should throw for invalid line', t => {
    let doc = createTextDocument(['foo', 'bar'])
    let fn = () => {
      doc.lineAt(-1)
    }
    assert.throws(fn, Error)
    fn = () => {
      doc.lineAt(3)
    }
    assert.throws(fn, Error)
  })

  it('should work when eol disabled', t => {
    let doc = new LinesTextDocument('file://a', 'txt', 1, ['foo'], 1, false)
    assert.strictEqual(doc.getText(), 'foo')
    assert.strictEqual(doc.lineCount, 1)
    assert.deepStrictEqual(doc.end, Position.create(0, 3))
  })

  it('should computeLinesOffsets', t => {
    assert.deepStrictEqual(computeLinesOffsets(['foo'], true), [0, 4])
    assert.deepStrictEqual(computeLinesOffsets(['foo'], false), [0])
  })

  it('should get uri for unknown buftype', t => {
    let res = getUri('foo', 3, '')
    assert.strictEqual(res, 'unknown:3')
    res = getUri('foo', 3, 'terminal')
    assert.deepStrictEqual(res, 'terminal:3')
    res = getUri(import.meta.filename, 3, 'terminal')
    assert.strictEqual(URI.parse(res).fsPath, import.meta.filename)
  })

  it('should preserve POSIX single-letter-colon path case (#2974)', t => {
    let res = getUri('/F:/x', 3, '')
    assert.strictEqual(res, 'file:///F%3A/x')
    assert.strictEqual(URI.parse(res).path, '/F:/x')
    assert.strictEqual(uriToFsPath(res), '/F:/x')
    // unaffected shapes keep the normal URI encoding
    assert.strictEqual(getUri('/home/user/F:/x', 3, ''), 'file:///home/user/F%3A/x')
    assert.strictEqual(uriToFsPath(getUri('/tmp/foo', 3, '')), '/tmp/foo')
  })

  it('should work with line not last one', t => {
    let doc = createTextDocument(['foo', 'bar'])
    let textLine = doc.lineAt(0)
    assert.strictEqual(textLine.lineNumber, 0)
    assert.strictEqual(textLine.text, 'foo')
    assert.deepStrictEqual(textLine.range, Range.create(0, 0, 0, 3))
    assert.deepStrictEqual(textLine.rangeIncludingLineBreak, Range.create(0, 0, 1, 0))
    assert.strictEqual(textLine.isEmptyOrWhitespace, false)
  })

  it('should work with last line', t => {
    let doc = createTextDocument(['foo', 'bar'])
    let textLine = doc.lineAt(2)
    assert.deepStrictEqual(textLine.rangeIncludingLineBreak, Range.create(2, 0, 2, 0))
  })

  it('should not attach when size exceeded', async t => {
    let reason = getNotAttachReason('', 1, 99)
    assert.match(reason, new RegExp('exceed'))
  })

  it('should get intersect range', async t => {
    let doc = createTextDocument(['foo', 'bar'])
    let res = doc.intersectWith(Range.create(0, 0, 2, 1))
    assert.deepStrictEqual(res, Range.create(0, 0, 2, 0))
  })
})

describe('Document', () => {
  before(async () => {
    nvim = workspace.nvim
  })
  afterEach(editorReset)

  describe('properties', () => {
    it('should get languageId', async t => {
      await nvim.command(`edit +setl\\ filetype=txt.vim foo`)
      let doc = await workspace.document
      assert.strictEqual(doc.languageId, 'txt')
    })

    it('should parse iskeyword of character range', async t => {
      await nvim.setOption('iskeyword', 'a-z,A-Z,48-57,_')
      let opt = await nvim.getOption('iskeyword')
      assert.strictEqual(opt, 'a-z,A-Z,48-57,_')
    })

    it('should get start word', async t => {
      let doc = await workspace.document
      assert.strictEqual(doc.getStartWord('abc def'), 'abc')
      assert.strictEqual(doc.getStartWord('x'), 'x')
      assert.strictEqual(doc.getStartWord(' '), '')
      assert.strictEqual(doc.getStartWord(''), '')
    })

    it('should get word range', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo bar#')
      await doc.synchronize()
      let range = doc.getWordRangeAtPosition({ line: 0, character: 0 })
      assert.deepStrictEqual(range, Range.create(0, 0, 0, 3))
      range = doc.getWordRangeAtPosition({ line: 0, character: 3 })
      assert.strictEqual(range, null)
      range = doc.getWordRangeAtPosition({ line: 0, character: 4 })
      assert.deepStrictEqual(range, Range.create(0, 4, 0, 7))
      range = doc.getWordRangeAtPosition({ line: 0, character: 7 })
      assert.strictEqual(range, null)
      range = doc.getWordRangeAtPosition({ line: 0, character: 7 }, '#')
      assert.deepStrictEqual(range, Range.create(0, 4, 0, 8))
    })

    it('should fix start col', async t => {
      let doc = await workspace.document
      assert.strictEqual(doc.fixStartcol(Position.create(0, 3), ['#']), 0)
      await nvim.setLine('foo #def')
      assert.strictEqual(doc.fixStartcol(Position.create(0, 6), ['#']), 4)
    })

    it('should get lines', async t => {
      let doc = await workspace.document
      let lines = doc.getLines()
      assert.deepStrictEqual(lines, [''])
    })

    it('should add additional keywords', async t => {
      await nvim.command(`edit foo | let b:coc_additional_keywords=['#']`)
      let doc = await workspace.document
      assert.strictEqual(doc.isWord('#'), true)
    })

    it('should check has changed', async t => {
      let doc = await workspace.document
      assert.strictEqual(doc.hasChanged, false)
      await nvim.setLine('foo bar')
      await shared.waitValue(() => {
        return doc.hasChanged
      }, false)
    })

    it('should get symbol ranges', async t => {
      let doc = await workspace.document
      await nvim.setLine('-foo bar foo')
      let ranges = doc.getSymbolRanges('foo')
      assert.strictEqual(ranges.length, 2)
    })

    it('should get current line', async t => {
      let doc = await workspace.document
      await setLines(doc, ['first line', 'second line'])
      let line = doc.getline(1, true)
      assert.strictEqual(line, 'second line')
      line = doc.getline(0, false)
      assert.strictEqual(line, 'first line')
    })

    it('should get variable form buffer', async t => {
      await nvim.command('autocmd BufNewFile,BufRead * let b:coc_variable = 1')
      let doc = await shared.createDocument()
      let val = doc.getVar('variable') as number
      assert.strictEqual(val, 1)
    })

    it('should attach change events', async t => {
      let doc = await workspace.document
      await nvim.setLine('abc')
      await doc.patchChange()
      let content = doc.getDocumentContent()
      assert.strictEqual(content.indexOf('abc'), 0)
    })

    it('should not attach change events when b:coc_enabled is false', async t => {
      nvim.command('edit t|let b:coc_enabled = 0', true)
      let doc = await workspace.document
      let val = doc.getVar<number>('enabled', 0)
      assert.strictEqual(val, 0)
      await nvim.setLine('abc')
      await doc.patchChange()
      let content = doc.getDocumentContent()
      assert.strictEqual(content.indexOf('abc'), -1)
      assert.match(doc.notAttachReason, new RegExp('coc_enabled'))
    })

    it('should attach nofile document by b:coc_force_attach', async t => {
      nvim.command(`e +setl\\ buftype=nofile foo| let b:coc_force_attach = 1`, true)
      let doc = await workspace.document
      assert.strictEqual(doc.buftype, 'nofile')
      assert.strictEqual(doc.attached, true)
    })

    it('should not attach nofile buffer', async t => {
      nvim.command('edit t|setl buftype=nofile', true)
      let doc = await workspace.document
      assert.match(doc.notAttachReason, new RegExp('nofile'))
    })

    it('should get lineCount, previewwindow, winid', async t => {
      let doc = await workspace.document
      let { lineCount, winid } = doc
      assert.strictEqual(lineCount, 1)
      assert.strictEqual(winid != -1, true)
    })
  })

  describe('attach()', () => {
    it('should not attach when buffer not loaded', async t => {
      await nvim.command('tabe foo')
      await events.fire('CursorHold', [await nvim.call('bufnr', ['%'])])
      let doc = await workspace.document
      let spy = t.mock.method(doc.buffer, 'attach', () => {
        return Promise.reject(new Error('detached'))
      })
      doc.attach()
      await nvim.command(`bd ${doc.bufnr}`)
      doc.attach()
      await shared.wait(20)
      assert.strictEqual(doc.attached, false)
      await doc.synchronize()
    })

    it('should consider eol option', async t => {
      await nvim.command('edit foo|setl noeol')
      await nvim.setLine('foo')
      let doc = await workspace.document
      assert.strictEqual(typeof doc.hasChanged, 'boolean')
      await doc.patchChange()
      await shared.waitValue(() => doc.content, 'foo')
    })
  })

  describe('applyEdits()', () => {
    it('should not throw with old API', async t => {
      let doc = await workspace.document
      await doc.applyEdits(nvim as any, [] as any)
      assert.strictEqual(doc.previewwindow, false)
    })

    it('should not apply when not change happens', async t => {
      let doc = await workspace.document
      let res = await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '')])
      assert.strictEqual(res, undefined)
    })

    it('should simple applyEdits', async t => {
      let doc = await workspace.document
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 0, 0),
        newText: 'a\n'
      })
      edits.push({
        range: Range.create(0, 0, 0, 0),
        newText: 'b\n'
      })
      let edit = await doc.applyEdits(edits)
      let content = doc.getDocumentContent()
      assert.strictEqual(content, 'a\nb\n\n')
      await doc.applyEdits([edit])
      assert.deepStrictEqual(doc.getDocumentContent(), '\n')
    })

    it('should return revert edit', async t => {
      let doc = await workspace.document
      let edit = await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 0, 0), 'foo')])
      assert.strictEqual(doc.getDocumentContent(), 'foo\n')
      edit = await doc.applyEdits([edit])
      assert.strictEqual(doc.getDocumentContent(), '\n')
      edit = await doc.applyEdits([edit])
      assert.strictEqual(doc.getDocumentContent(), 'foo\n')
    })

    it('should apply merged edits', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      await doc.patchChange()
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 0, 3),
        newText: ''
      })
      edits.push({
        range: Range.create(0, 0, 0, 0),
        newText: 'bar'
      })
      let edit = await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, 'bar')
      await doc.applyEdits([edit])
      assert.strictEqual(doc.getDocumentContent(), 'foo\n')
    })

    it('should apply textedit exceed end', async t => {
      let doc = await workspace.document
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 999999, 99999),
        newText: 'foo\n'
      })
      await doc.applyEdits(edits)
      let content = doc.getDocumentContent()
      assert.strictEqual(content, 'foo\n')
    })

    it('should move cursor', async t => {
      await nvim.input('ia')
      await shared.waitFor('mode', [], 'i')
      let doc = await workspace.document
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 0, 1),
        newText: 'foo'
      })
      await doc.applyEdits(edits, false, true)
      let cursor = await nvim.call('getcurpos') as number[]
      assert.strictEqual(cursor[1], 1)
      assert.strictEqual(cursor[2], 4)
    })

    it('should applyEdits with range not sorted', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines([
        'aa',
        'bb',
        'cc',
        'dd'
      ], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      let edits = [
        { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } }, newText: "" },
        { range: { start: { line: 0, character: 2 }, end: { line: 1, character: 0 } }, newText: "" },
      ]
      await doc.applyEdits(edits)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['aabb', 'cc', 'd'])
    })

    it('should applyEdits with insert as same position', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines([
        'foo'
      ], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      let edits = [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'aa' },
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'bb' },
      ]
      await doc.applyEdits(edits)
      let lines = await nvim.call('getline', [1, '$'])
      assert.deepStrictEqual(lines, ['aabbfoo'])
    })

    it('should applyEdits with bad range', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines([], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      let edits = [{ range: { start: { line: -1, character: -1 }, end: { line: -1, character: -1 } }, newText: 'foo' },]
      await doc.applyEdits(edits)
      let lines = await nvim.call('getline', [1, '$'])
      assert.deepStrictEqual(lines, ['foo'])
    })

    it('should applyEdits with lines', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines([
        'aa',
        'bb',
        'cc',
        'dd'
      ], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      let edits = [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "" },
        { range: { start: { line: 0, character: 2 }, end: { line: 1, character: 0 } }, newText: "" },
      ]
      await doc.applyEdits(edits)
      let lines = await nvim.call('getline', [1, '$'])
      assert.deepStrictEqual(lines, ['abb', 'cc', 'dd'])
    })

    it('should applyEdits with changed lines', async t => {
      let doc = await workspace.document
      let buf = doc.buffer
      const assertChange = async (sl, sc, el, ec, text, lines) => {
        let r = Range.create(sl, sc, el, ec)
        let edits = [TextEdit.replace(r, text)]
        await doc.applyEdits(edits)
        let curr = await buf.lines
        assert.deepStrictEqual(curr, lines)
      }
      await nvim.setLine('a')
      await doc.patchChange()
      await assertChange(0, 1, 0, 1, '\nb', ['a', 'b'])
      await assertChange(1, 0, 2, 0, 'c\n', ['a', 'c'])
      await assertChange(1, 0, 2, 0, '', ['a'])
      await assertChange(1, 0, 1, 0, 'b\nc\n', ['a', 'b', 'c'])
      await assertChange(2, 0, 3, 0, 'e\n', ['a', 'b', 'e'])
    })

    it('should apply single textedit', async t => {
      let doc = await workspace.document
      let buf = doc.buffer
      const assertChange = async (sl, sc, el, ec, text, lines) => {
        let r = Range.create(sl, sc, el, ec)
        let edits = [TextEdit.replace(r, text)]
        await doc.applyEdits(edits)
        let curr = await buf.lines
        assert.deepStrictEqual(curr, lines)
      }
      await nvim.setLine('foo')
      await doc.patchChange()
      await assertChange(1, 0, 1, 0, 'bar', ['foo', 'bar'])
      await assertChange(2, 0, 2, 0, 'do\n', ['foo', 'bar', 'do'])
      await assertChange(2, 1, 3, 0, '', ['foo', 'bar', 'd'])
      await assertChange(2, 0, 3, 0, 'if', ['foo', 'bar', 'if'])
      await assertChange(2, 0, 2, 2, 'x', ['foo', 'bar', 'x'])
    })

    it('should apply multiple edits', async t => {
      let arr = new Array(200)
      arr.fill('foo bar a b c d e')
      let ranges: Range[] = []
      let edits: TextEdit[] = []
      for (let i = 0; i < arr.length; i++) {
        ranges.push(Range.create(i, 0, i, 3))
        ranges.push(Range.create(i, 4, i, 7))
        ranges.push(Range.create(i, 8, i, 9))
        ranges.push(Range.create(i, 10, i, 11))
        ranges.push(Range.create(i, 12, i, 13))
        ranges.push(Range.create(i, 14, i, 15))
        ranges.push(Range.create(i, 16, i, 17))
        edits.push(TextEdit.insert(Position.create(i, 0), `${i + 1} `))
      }
      let doc = await shared.createDocument()
      let buf = doc.buffer
      await buf.setLines(arr)
      buf.highlightRanges('test', 'MoreMsg', ranges)
      await doc.patchChange()
      await doc.applyEdits(edits)
    })

    it('should consider latest change', async t => {
      let doc = await shared.createDocument()
      let buf = doc.buffer
      {
        let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), 'bar')]
        nvim.call('setline', [1, 'foo'], true)
        await doc.applyEdits(edits)
        let line = await nvim.line
        assert.strictEqual(line, 'barfoo')
      }
      {
        await buf.setLines(['  foo'])
        await doc.patchChange()
        nvim.call('setline', [1, '  fooa'], true)
        nvim.call('cursor', [1, 7], true)
        let edits: TextEdit[] = [TextEdit.del(Range.create(0, 0, 0, 1))]
        await doc.applyEdits(edits)
        let line = await nvim.line
        assert.strictEqual(line, ' fooa')
      }
      {
        await buf.setLines(['foo'])
        await nvim.call('cursor', [1, 3])
        await doc.synchronize()
        nvim.call('setline', [1, 'fo'], true)
        let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), ' ')]
        await doc.applyEdits(edits)
        let line = await nvim.line
        assert.strictEqual(line, ' fo')
      }
    })

    it('should merge multiple concurrent edits', async t => {
      let doc = await shared.createDocument()
      let buf = doc.buffer
      await buf.setLines(['abcdef'])
      await doc.patchChange()
      nvim.call('setline', [1, 'aBcdEf'], true)
      nvim.call('cursor', [1, 5], true)
      let edits: TextEdit[] = [TextEdit.replace(Range.create(0, 2, 0, 3), 'C')]
      await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, 'aBCdEf')
    })

    it('should merge concurrent edits with multibyte characters', async t => {
      let doc = await shared.createDocument()
      let buf = doc.buffer
      await buf.setLines(['你a你b'])
      await doc.patchChange()
      nvim.call('setline', [1, '你A你B'], true)
      nvim.call('cursor', [1, 4], true)
      let edits: TextEdit[] = [TextEdit.replace(Range.create(0, 0, 0, 1), '好')]
      await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, '好A你B')
    })
  })

  describe('changeLines()', () => {
    it('should change lines', async t => {
      let doc = await workspace.document
      await doc.changeLines([[0, '']])
      await doc.buffer.replace(['a', 'b', 'c'], 0)
      await doc.changeLines([[0, 'd'], [2, 'f']])
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['d', 'b', 'f'])
    })
  })

  describe('getOffset()', () => {
    it('should get offset', async t => {
      let doc = await workspace.document
      let offset = doc.getOffset(1, 0)
      assert.strictEqual(offset, 0)
    })
  })

  describe('synchronize', () => {
    it('should synchronize on lines change', async t => {
      let document = await workspace.document
      let doc = TextDocument.create('untitled:1', 'txt', 1, document.getDocumentContent())
      let disposables = []
      document.onDocumentChange(e => {
        TextDocument.update(doc, e.contentChanges.slice(), 2)
      }, null, disposables)
      // document.on
      await nvim.setLine('abc')
      document.forceSync()
      assert.strictEqual(doc.getText(), 'abc\n')
      disposeAll(disposables)
    })

    it('should synchronize changes after applyEdits', async t => {
      let document = await workspace.document
      let doc = TextDocument.create('untitled:1', 'txt', 1, document.getDocumentContent())
      let disposables = []
      document.onDocumentChange(e => {
        TextDocument.update(doc, e.contentChanges.slice(), e.textDocument.version)
      }, null, disposables)
      await nvim.setLine('abc')
      await document.patchChange()
      await document.applyEdits([TextEdit.insert({ line: 0, character: 0 }, 'd')])
      assert.strictEqual(doc.getText(), 'dabc\n')
      disposeAll(disposables)
    })

    it('should consider empty lines', async t => {
      let document = await workspace.document
      await nvim.call('setline', [1, ['foo', 'bar']])
      await document.patchChange()
      await nvim.command('normal! ggdG')
      await nvim.call('append', [1, ['foo', 'bar']])
      await document.patchChange()
      let lines = document.textDocument.lines
      assert.deepStrictEqual(lines, ['', 'foo', 'bar'])
    })
  })

  describe('recreate', () => {
    async function assertDocument(fn: (doc: Document) => Promise<void>): Promise<void> {
      let disposables: Disposable[] = []
      let fsPath = path.join(import.meta.dirname, 'document.txt')
      fs.writeFileSync(fsPath, '{\nfoo\n}\n', 'utf8')
      await shared.edit(fsPath)
      let document = await workspace.document
      document.forceSync()
      let doc = TextDocument.create(document.uri, 'txt', document.version, document.getDocumentContent())
      let uri = doc.uri
      workspace.onDidOpenTextDocument(e => {
        if (e.uri == uri) {
          doc = TextDocument.create(e.uri, 'txt', e.version, e.getText())
        }
      }, null, disposables)
      workspace.onDidCloseTextDocument(e => {
        if (e.uri == doc.uri) doc = null
      }, null, disposables)
      workspace.onDidChangeTextDocument(e => {
        TextDocument.update(doc, e.contentChanges.slice(), e.textDocument.version)
      }, null, disposables)
      await fn(document)
      document = await workspace.document
      document.forceSync()
      let text = document.getDocumentContent()
      assert.notStrictEqual(doc, undefined)
      assert.strictEqual(doc.getText(), text)
      disposeAll(disposables)
      fs.unlinkSync(fsPath)
    }

    it('should synchronize after make changes', async t => {
      await assertDocument(async () => {
        await nvim.call('setline', [1, 'a'])
        await nvim.call('setline', [2, 'b'])
      })
    })

    it('should synchronize after edit', async t => {
      await assertDocument(async doc => {
        let fsPath = URI.parse(doc.uri).fsPath
        fs.writeFileSync(fsPath, '{\n}\n', 'utf8')
        await nvim.command('edit')
        await nvim.call('deletebufline', [doc.bufnr, 1])
        doc = await workspace.document
        let content = doc.getDocumentContent()
        assert.strictEqual(content, '}\n')
      })
    })

    it('should synchronize after force edit', async t => {
      await assertDocument(async doc => {
        let fsPath = URI.parse(doc.uri).fsPath
        fs.writeFileSync(fsPath, '{\n}\n', 'utf8')
        await nvim.command('edit')
        await nvim.call('deletebufline', [doc.bufnr, 1])
        doc = await workspace.document
        let content = doc.getDocumentContent()
        assert.strictEqual(content, '}\n')
      })
    })
  })

  describe('applyEdits', () => {
    it('should synchronize on enter', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines(['foox', 'bar'])
      await nvim.call('cursor', [1, 2])
      await nvim.input('a')
      await doc.synchronize()
      void nvim.input('<cr>x')
      await doc.applyEdits([{
        range: Range.create(0, 0, 1, 3),
        newText: '"foox"\n"bar"'
      }])
      await shared.waitFor('getline', ['.'], 'xox"')
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['"fo', 'xox"', '"bar"'])
    })

    it('should synchronize content add on apply', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines(['aaa', 'bbb', 'ccc'])
      await nvim.call('cursor', [2, 1])
      void nvim.input('Ab')
      await doc.applyEdits([{
        range: Range.create(0, 0, 0, 0),
        newText: '1'
      }, {
        range: Range.create(1, 0, 1, 0),
        newText: '2'
      }, {
        range: Range.create(2, 0, 2, 0),
        newText: '3'
      }, {
        range: Range.create(2, 3, 2, 3),
        newText: '\nfoo'
      }])
      await shared.waitFor('getline', ['.'], '2bbbb')
      let lines = doc.getLines()
      assert.deepStrictEqual(lines, ['1aaa', '2bbbb', '3ccc', 'foo'])
    })

    it('should synchronize content change on multiple lines change', async t => {
      let arr = (new Array(40)).fill('')
      let doc = await workspace.document
      await doc.buffer.setLines(arr)
      await nvim.call('cursor', [1, 1])
      let edits: TextEdit[] = []
      let contents = []
      for (let i = 0; i < arr.length; i++) {
        edits.push(TextEdit.insert(Position.create(i, 0), `${i}`))
        contents.push(`${i}`)
      }
      void nvim.input('Ax')
      await doc.applyEdits(edits)
      await shared.waitFor('getline', ['.'], '0x')
      contents[0] = '0x'
      let lines = doc.getLines()
      assert.deepStrictEqual(lines, contents)
    })

    it('should synchronize content delete', async t => {
      let doc = await workspace.document
      await doc.buffer.setLines(['foo f', 'bar'])
      await doc.synchronize()
      await nvim.command('normal! ^2l')
      void nvim.input('a<backspace>')
      await doc.applyEdits([{
        range: Range.create(0, 0, 1, 3),
        newText: 'foo foo'
      }])
      await shared.waitFor('getline', ['.'], 'fo foo')
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['fo foo'])
    })
  })

  describe('text merge', () => {
    async function mergeLine(base: string, ours: string, theirs: string): Promise<string | null> {
      return await nvim.request('nvim_exec_lua', [
        `return require('coc.text').mergeLine(...)`,
        [base, ours, theirs]
      ]) as string | null
    }

    it('should merge multiple concurrent edits', async t => {
      assert.strictEqual(await mergeLine('abcdef', 'aBcdEf', 'abCdef'), 'aBCdEf')
      assert.strictEqual(await mergeLine('abcd', 'axbycd', 'aXcd'), 'axXycd')
    })

    it('should keep user text when edits overlap', async t => {
      assert.strictEqual(await mergeLine('abc', 'aXc', 'aYc'), 'aXc')
      assert.strictEqual(await mergeLine('abcde', 'abde', 'abCde'), 'abde')
      assert.strictEqual(await mergeLine('abcdef', 'abef', 'abcXdef'), 'abef')
    })

    it('should merge with multibyte characters', async t => {
      assert.strictEqual(await mergeLine('你a你b', '你A你B', '好a你b'), '好A你B')
      assert.strictEqual(await mergeLine('a😀b', 'B😀C', 'aX😀b'), 'BX😀C')
    })

    it('should keep user text for very long lines', async t => {
      let base = 'a'.repeat(300)
      let ours = 'a'.repeat(100) + 'x' + 'a'.repeat(49) + 'y' + 'a'.repeat(150)
      let theirs = 'a'.repeat(100) + 'b' + 'a'.repeat(49) + 'c' + 'a'.repeat(149)
      assert.strictEqual(await mergeLine(base, ours, theirs), null)
    })

    it('should merge without performance regression', async t => {
      let base = 'ab'.repeat(100)
      let ours = base.slice(0, 150) + 'x' + base.slice(151)
      let theirs = base.slice(0, 100) + 'Y' + base.slice(101)
      let elapsed = await nvim.request('nvim_exec_lua', [
        `local text = require('coc.text')
         local start = vim.uv.hrtime()
         for i = 1, 30 do
           text.mergeLine(...)
         end
         return (vim.uv.hrtime() - start) / 1e6`,
        [base, ours, theirs]
      ]) as number
      assert.ok(elapsed < 5000)
    })

    it('should skip merge for very long lines', async t => {
      let base = 'a'.repeat(2000)
      let ours = 'a'.repeat(1999) + 'x'
      let theirs = 'a'.repeat(1999) + 'y'
      let elapsed = await nvim.request('nvim_exec_lua', [
        `local text = require('coc.text')
         local start = vim.uv.hrtime()
         for i = 1, 500 do
           text.mergeLine(...)
         end
         return (vim.uv.hrtime() - start) / 1e6`,
        [base, ours, theirs]
      ]) as number
      assert.ok(elapsed < 5000)
    })
  })

  describe('highlights', () => {
    it('should add highlights to document', async t => {
      let buf = await nvim.buffer
      await buf.setLines(['你好', 'world'], { start: 0, end: -1, strictIndexing: false })
      let ranges = [
        Range.create(0, 0, 0, 2),
        Range.create(1, 0, 1, 3)
      ]
      let ns = await nvim.createNamespace('coc-highlight')
      nvim.pauseNotification()
      buf.highlightRanges('highlight', 'Search', ranges)
      await nvim.resumeNotification()
      let markers = await buf.getExtMarks(ns, 0, -1)
      assert.strictEqual(markers.length, 2)
      nvim.pauseNotification()
      buf.clearNamespace('highlight')
      await nvim.resumeNotification()
      markers = await buf.getExtMarks(ns, 0, -1)
      assert.strictEqual(markers.length, 0)
    })

    it('should add and clear highlights of current window', async t => {
      let buf = await nvim.buffer
      await buf.setLines(['你好', 'world'], { start: 0, end: -1, strictIndexing: false })
      let win = await nvim.window
      let ranges = [
        Range.create(0, 0, 0, 2),
        Range.create(1, 0, 1, 3)
      ]
      let res = await win.highlightRanges('Search', ranges)
      assert.strictEqual(res.length, 1)
      let matches = await nvim.call('getmatches', [win.id]) as any
      nvim.pauseNotification()
      win.clearMatchGroup('Search')
      await nvim.resumeNotification()
      matches = await nvim.call('getmatches', [win.id])
      assert.strictEqual(matches.length, 0)
    })

    it('should clear matches by ids', async t => {
      let buf = await nvim.buffer
      await buf.setLines(['你好', 'world'], { start: 0, end: -1, strictIndexing: false })
      let win = await nvim.window
      let ranges = [
        Range.create(0, 0, 0, 2),
        Range.create(1, 0, 1, 3)
      ]
      let ids = await win.highlightRanges('Search', ranges)
      nvim.pauseNotification()
      win.clearMatches(ids)
      await nvim.resumeNotification()
      let matches = await nvim.call('getmatches', [win.id]) as any
      assert.strictEqual(matches.length, 0)
    })
  })
})
