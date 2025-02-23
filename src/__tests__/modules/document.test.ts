import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import Document, { getNotAttachReason, getUri } from '../../model/document'
import { computeLinesOffsets, LinesTextDocument } from '../../model/textdocument'
import { Disposable, disposeAll } from '../../util'
import { applyEdits, filterSortEdits } from '../../util/textedit'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim

function createTextDocument(lines: string[], eol = true): LinesTextDocument {
  return new LinesTextDocument('file://a', 'txt', 1, lines, 1, eol)
}

async function setLines(doc: Document, lines: string[]): Promise<void> {
  let edit = TextEdit.insert(Position.create(0, 0), lines.join('\n'))
  await doc.applyEdits([edit])
}

describe('LinesTextDocument', () => {
  it('should apply edits', () => {
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
    expect(res).toEqual(['use std::io::{Result, Error};'])
  })

  it('should throw for overlapping edits', () => {
    let textDocument = new LinesTextDocument('', '', 1, [
      'use std::io::Result;'
    ], 1, true)
    let edits = [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: "foo" },
      { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, newText: "new" }
    ]
    expect(() => {
      applyEdits(textDocument, edits)
    }).toThrow()
  })

  it('should return undefined when not changed', () => {
    let textDocument = new LinesTextDocument('', '', 1, [
      'foo bar'
    ], 1, true)
    let edits = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "f" },
      { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: "o" }
    ]
    let res = applyEdits(textDocument, edits)
    expect(res).toBeUndefined()
  })

  it('should get length', () => {
    let doc = createTextDocument(['foo'])
    expect(doc.length).toBe(4)
    expect(doc.getText().length).toBe(4)
    expect(doc.length).toBe(4)
    doc = createTextDocument(['foo'], false)
    expect(doc.length).toBe(3)
  })

  it('should getText by range', () => {
    let doc = createTextDocument(['foo', 'bar'])
    expect(doc.getText(Range.create(0, 0, 0, 1))).toBe('f')
    expect(doc.getText(Range.create(0, 0, 1, 0))).toBe('foo\n')
  })

  it('should get positionAt', () => {
    let doc = createTextDocument([], false)
    expect(doc.positionAt(0)).toEqual(Position.create(0, 0))
  })

  it('should get offsetAt', () => {
    let doc = createTextDocument([''], false)
    expect(doc.offsetAt(Position.create(1, 0))).toBe(0)
    expect(doc.offsetAt({ line: -1, character: -1 })).toBe(0)
  })

  it('should work when eol enabled', () => {
    let doc = createTextDocument(['foo', 'bar'])
    expect(doc.lineCount).toBe(3)
    let content = doc.getText()
    expect(content).toBe('foo\nbar\n')
    content = doc.getText(Range.create(0, 0, 0, 3))
    expect(content).toBe('foo')
    let textLine = doc.lineAt(0)
    expect(textLine.text).toBe('foo')
    textLine = doc.lineAt(Position.create(0, 3))
    expect(textLine.text).toBe('foo')
    let pos = doc.positionAt(4)
    expect(pos).toEqual({ line: 1, character: 0 })
    content = doc.getText(Range.create(0, 0, 0, 3))
    expect(content).toBe('foo')
    let offset = doc.offsetAt(Position.create(0, 4))
    expect(offset).toBe(4)
    offset = doc.offsetAt(Position.create(2, 1))
    expect(offset).toBe(8)
    expect(doc.end).toEqual(Position.create(2, 0))
  })

  it('should throw for invalid line', () => {
    let doc = createTextDocument(['foo', 'bar'])
    let fn = () => {
      doc.lineAt(-1)
    }
    expect(fn).toThrow(Error)
    fn = () => {
      doc.lineAt(3)
    }
    expect(fn).toThrow(Error)
  })

  it('should work when eol disabled', () => {
    let doc = new LinesTextDocument('file://a', 'txt', 1, ['foo'], 1, false)
    expect(doc.getText()).toBe('foo')
    expect(doc.lineCount).toBe(1)
    expect(doc.end).toEqual(Position.create(0, 3))
  })

  it('should computeLinesOffsets', () => {
    expect(computeLinesOffsets(['foo'], true)).toEqual([0, 4])
    expect(computeLinesOffsets(['foo'], false)).toEqual([0])
  })

  it('should get uri for unknown buftype', () => {
    let res = getUri('foo', 3, '', false)
    expect(res).toBe('unknown:3')
    res = getUri('foo', 3, 'terminal', false)
    expect(res).toEqual('terminal:3')
    res = getUri(__filename, 3, 'terminal', true)
    expect(URI.parse(res).fsPath).toBe(__filename)
  })

  it('should work with line not last one', () => {
    let doc = createTextDocument(['foo', 'bar'])
    let textLine = doc.lineAt(0)
    expect(textLine.lineNumber).toBe(0)
    expect(textLine.text).toBe('foo')
    expect(textLine.range).toEqual(Range.create(0, 0, 0, 3))
    expect(textLine.rangeIncludingLineBreak).toEqual(Range.create(0, 0, 1, 0))
    expect(textLine.isEmptyOrWhitespace).toBe(false)
  })

  it('should work with last line', () => {
    let doc = createTextDocument(['foo', 'bar'])
    let textLine = doc.lineAt(2)
    expect(textLine.rangeIncludingLineBreak).toEqual(Range.create(2, 0, 2, 0))
  })

  it('should not attach when size exceeded', async () => {
    let reason = getNotAttachReason('', 1, 99)
    expect(reason).toMatch('exceed')
  })
})

describe('Document', () => {
  beforeAll(async () => {
    await helper.setup()
    nvim = helper.nvim
  })

  afterAll(async () => {
    await helper.shutdown()
  })

  afterEach(async () => {
    await helper.reset()
  })

  describe('properties', () => {
    it('should get languageId', async () => {
      await nvim.command(`edit +setl\\ filetype=txt.vim foo`)
      let doc = await workspace.document
      expect(doc.languageId).toBe('txt')
    })

    it('should parse iskeyword of character range', async () => {
      await nvim.setOption('iskeyword', 'a-z,A-Z,48-57,_')
      let opt = await nvim.getOption('iskeyword')
      expect(opt).toBe('a-z,A-Z,48-57,_')
    })

    it('should get start word', async () => {
      let doc = await workspace.document
      expect(doc.getStartWord('abc def')).toBe('abc')
      expect(doc.getStartWord('x')).toBe('x')
      expect(doc.getStartWord(' ')).toBe('')
      expect(doc.getStartWord('')).toBe('')
    })

    it('should get word range', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo bar#')
      await doc.synchronize()
      let range = doc.getWordRangeAtPosition({ line: 0, character: 0 })
      expect(range).toEqual(Range.create(0, 0, 0, 3))
      range = doc.getWordRangeAtPosition({ line: 0, character: 3 })
      expect(range).toBeNull()
      range = doc.getWordRangeAtPosition({ line: 0, character: 4 })
      expect(range).toEqual(Range.create(0, 4, 0, 7))
      range = doc.getWordRangeAtPosition({ line: 0, character: 7 })
      expect(range).toBeNull()
      range = doc.getWordRangeAtPosition({ line: 0, character: 7 }, '#')
      expect(range).toEqual(Range.create(0, 4, 0, 8))
    })

    it('should fix start col', async () => {
      let doc = await workspace.document
      expect(doc.fixStartcol(Position.create(0, 3), ['#'])).toBe(0)
      await nvim.setLine('foo #def')
      expect(doc.fixStartcol(Position.create(0, 6), ['#'])).toBe(4)
    })

    it('should get lines', async () => {
      let doc = await workspace.document
      let lines = doc.getLines()
      expect(lines).toEqual([''])
    })

    it('should add additional keywords', async () => {
      await nvim.command(`edit foo | let b:coc_additional_keywords=['#']`)
      let doc = await workspace.document
      expect(doc.isWord('#')).toBe(true)
    })

    it('should check has changed', async () => {
      let doc = await workspace.document
      expect(doc.hasChanged).toBe(false)
      await nvim.setLine('foo bar')
      await helper.waitValue(() => {
        return doc.hasChanged
      }, false)
    })

    it('should get symbol ranges', async () => {
      let doc = await workspace.document
      await nvim.setLine('-foo bar foo')
      let ranges = doc.getSymbolRanges('foo')
      expect(ranges.length).toBe(2)
    })

    it('should get current line', async () => {
      let doc = await workspace.document
      await setLines(doc, ['first line', 'second line'])
      let line = doc.getline(1, true)
      expect(line).toBe('second line')
      line = doc.getline(0, false)
      expect(line).toBe('first line')
    })

    it('should get variable form buffer', async () => {
      await nvim.command('autocmd BufNewFile,BufRead * let b:coc_variable = 1')
      let doc = await helper.createDocument()
      let val = doc.getVar<number>('variable')
      expect(val).toBe(1)
    })

    it('should attach change events', async () => {
      let doc = await workspace.document
      await nvim.setLine('abc')
      await doc.patchChange()
      let content = doc.getDocumentContent()
      expect(content.indexOf('abc')).toBe(0)
    })

    it('should not attach change events when b:coc_enabled is false', async () => {
      nvim.command('edit t|let b:coc_enabled = 0', true)
      let doc = await workspace.document
      let val = doc.getVar<number>('enabled', 0)
      expect(val).toBe(0)
      await nvim.setLine('abc')
      await doc.patchChange()
      let content = doc.getDocumentContent()
      expect(content.indexOf('abc')).toBe(-1)
      expect(doc.notAttachReason).toMatch('coc_enabled')
    })

    it('should attach nofile document by b:coc_force_attach', async () => {
      nvim.command(`e +setl\\ buftype=nofile foo| let b:coc_force_attach = 1`, true)
      let doc = await workspace.document
      expect(doc.buftype).toBe('nofile')
      expect(doc.attached).toBe(true)
    })

    it('should not attach nofile buffer', async () => {
      nvim.command('edit t|setl buftype=nofile', true)
      let doc = await workspace.document
      expect(doc.notAttachReason).toMatch('nofile')
    })

    it('should get lineCount, previewwindow, winid', async () => {
      let doc = await workspace.document
      let { lineCount, winid } = doc
      expect(lineCount).toBe(1)
      expect(winid != -1).toBe(true)
    })

    it('should set filetype', async () => {
      let doc = await workspace.document
      doc.setFiletype('javascript.jsx')
      expect(doc.filetype).toBe('javascriptreact')
      doc.setFiletype('typescript.jsx')
      expect(doc.filetype).toBe('typescriptreact')
      doc.setFiletype('typescript.tsx')
      expect(doc.filetype).toBe('typescriptreact')
      doc.setFiletype('tex')
      expect(doc.filetype).toBe('latex')
      doc.setFiletype('foo')
      expect(doc.filetype).toBe('foo')
    })
  })

  describe('attach()', () => {
    it('should not attach when buffer not loaded', async () => {
      await nvim.command('tabe foo | doautocmd CursorHold')
      let doc = await workspace.document
      let spy = jest.spyOn(doc.buffer, 'attach').mockImplementation(() => {
        return Promise.reject(new Error('detached'))
      })
      doc.attach()
      spy.mockRestore()
      await nvim.command(`bd ${doc.bufnr}`)
      doc.attach()
      await helper.wait(10)
      expect(doc.attached).toBe(false)
      await doc.synchronize()
    })

    it('should consider eol option', async () => {
      await nvim.command('edit foo|setl noeol')
      await nvim.setLine('foo')
      let doc = await workspace.document
      expect(typeof doc.hasChanged).toBe('boolean')
      await doc.patchChange()
      await helper.waitValue(() => doc.content, 'foo')
    })
  })

  describe('applyEdits()', () => {
    it('should not throw with old API', async () => {
      let doc = await workspace.document
      await doc.applyEdits(nvim as any, [] as any)
      expect(doc.previewwindow).toBe(false)
    })

    it('should not apply when not change happens', async () => {
      let doc = await workspace.document
      let res = await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '')])
      expect(res).toBeUndefined()
    })

    it('should simple applyEdits', async () => {
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
      expect(content).toBe('a\nb\n\n')
      await doc.applyEdits([edit])
      expect(doc.getDocumentContent()).toEqual('\n')
    })

    it('should return revert edit', async () => {
      let doc = await workspace.document
      let edit = await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 0, 0), 'foo')])
      expect(doc.getDocumentContent()).toBe('foo\n')
      edit = await doc.applyEdits([edit])
      expect(doc.getDocumentContent()).toBe('\n')
      edit = await doc.applyEdits([edit])
      expect(doc.getDocumentContent()).toBe('foo\n')
    })

    it('should apply merged edits', async () => {
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
      expect(line).toBe('bar')
      await doc.applyEdits([edit])
      expect(doc.getDocumentContent()).toBe('foo\n')
    })

    it('should apply textedit exceed end', async () => {
      let doc = await workspace.document
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 999999, 99999),
        newText: 'foo\n'
      })
      await doc.applyEdits(edits)
      let content = doc.getDocumentContent()
      expect(content).toBe('foo\n')
    })

    it('should move cursor', async () => {
      await nvim.input('ia')
      await helper.wait(30)
      let doc = await workspace.document
      let edits: TextEdit[] = []
      edits.push({
        range: Range.create(0, 0, 0, 1),
        newText: 'foo'
      })
      await doc.applyEdits(edits, false, true)
      let cursor = await nvim.call('getcurpos') as number[]
      expect(cursor[1]).toBe(1)
      expect(cursor[2]).toBe(4)
    })

    it('should applyEdits with range not sorted', async () => {
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
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['aabb', 'cc', 'd'])
    })

    it('should applyEdits with insert as same position', async () => {
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
      expect(lines).toEqual(['aabbfoo'])
    })

    it('should applyEdits with bad range', async () => {
      let doc = await workspace.document
      await doc.buffer.setLines([], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      let edits = [{ range: { start: { line: -1, character: -1 }, end: { line: -1, character: -1 } }, newText: 'foo' },]
      await doc.applyEdits(edits)
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['foo'])
    })

    it('should applyEdits with lines', async () => {
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
      expect(lines).toEqual(['abb', 'cc', 'dd'])
    })

    it('should applyEdits with changed lines', async () => {
      let doc = await workspace.document
      let buf = doc.buffer
      const assertChange = async (sl, sc, el, ec, text, lines) => {
        let r = Range.create(sl, sc, el, ec)
        let edits = [TextEdit.replace(r, text)]
        await doc.applyEdits(edits)
        let curr = await buf.lines
        expect(curr).toEqual(lines)
      }
      await nvim.setLine('a')
      await doc.patchChange()
      await assertChange(0, 1, 0, 1, '\nb', ['a', 'b'])
      await assertChange(1, 0, 2, 0, 'c\n', ['a', 'c'])
      await assertChange(1, 0, 2, 0, '', ['a'])
      await assertChange(1, 0, 1, 0, 'b\nc\n', ['a', 'b', 'c'])
      await assertChange(2, 0, 3, 0, 'e\n', ['a', 'b', 'e'])
    })

    it('should apply single textedit', async () => {
      let doc = await workspace.document
      let buf = doc.buffer
      const assertChange = async (sl, sc, el, ec, text, lines) => {
        let r = Range.create(sl, sc, el, ec)
        let edits = [TextEdit.replace(r, text)]
        await doc.applyEdits(edits)
        let curr = await buf.lines
        expect(curr).toEqual(lines)
      }
      await nvim.setLine('foo')
      await doc.patchChange()
      await assertChange(1, 0, 1, 0, 'bar', ['foo', 'bar'])
      await assertChange(2, 0, 2, 0, 'do\n', ['foo', 'bar', 'do'])
      await assertChange(2, 1, 3, 0, '', ['foo', 'bar', 'd'])
      await assertChange(2, 0, 3, 0, 'if', ['foo', 'bar', 'if'])
      await assertChange(2, 0, 2, 2, 'x', ['foo', 'bar', 'x'])
    })
  })

  describe('changeLines()', () => {
    it('should change lines', async () => {
      let doc = await workspace.document
      await doc.changeLines([[0, '']])
      await doc.buffer.replace(['a', 'b', 'c'], 0)
      await doc.changeLines([[0, 'd'], [2, 'f']])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['d', 'b', 'f'])
    })
  })

  describe('getOffset()', () => {
    it('should get offset', async () => {
      let doc = await workspace.document
      let offset = doc.getOffset(1, 0)
      expect(offset).toBe(0)
    })
  })

  describe('synchronize', () => {
    it('should synchronize on lines change', async () => {
      let document = await workspace.document
      let doc = TextDocument.create('untitled:1', 'txt', 1, document.getDocumentContent())
      let disposables = []
      document.onDocumentChange(e => {
        TextDocument.update(doc, e.contentChanges.slice(), 2)
      }, null, disposables)
      // document.on
      await nvim.setLine('abc')
      document.forceSync()
      expect(doc.getText()).toBe('abc\n')
      disposeAll(disposables)
    })

    it('should synchronize changes after applyEdits', async () => {
      let document = await workspace.document
      let doc = TextDocument.create('untitled:1', 'txt', 1, document.getDocumentContent())
      let disposables = []
      document.onDocumentChange(e => {
        TextDocument.update(doc, e.contentChanges.slice(), e.textDocument.version)
      }, null, disposables)
      await nvim.setLine('abc')
      await document.patchChange()
      await document.applyEdits([TextEdit.insert({ line: 0, character: 0 }, 'd')])
      expect(doc.getText()).toBe('dabc\n')
      disposeAll(disposables)
    })

    it('should consider empty lines', async () => {
      let document = await workspace.document
      await nvim.call('setline', [1, ['foo', 'bar']])
      await document.patchChange()
      await nvim.command('normal! ggdG')
      await nvim.call('append', [1, ['foo', 'bar']])
      await document.patchChange()
      let lines = document.textDocument.lines
      expect(lines).toEqual(['', 'foo', 'bar'])
    })
  })

  describe('recreate', () => {
    async function assertDocument(fn: (doc: Document) => Promise<void>): Promise<void> {
      let disposables: Disposable[] = []
      let fsPath = path.join(__dirname, 'document.txt')
      fs.writeFileSync(fsPath, '{\nfoo\n}\n', 'utf8')
      await helper.edit(fsPath)
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
      expect(doc).toBeDefined()
      expect(doc.getText()).toBe(text)
      disposeAll(disposables)
      fs.unlinkSync(fsPath)
    }

    it('should synchronize after make changes', async () => {
      await assertDocument(async () => {
        await nvim.call('setline', [1, 'a'])
        await nvim.call('setline', [2, 'b'])
      })
    })

    it('should synchronize after edit', async () => {
      await assertDocument(async doc => {
        let fsPath = URI.parse(doc.uri).fsPath
        fs.writeFileSync(fsPath, '{\n}\n', 'utf8')
        await nvim.command('edit')
        await nvim.call('deletebufline', [doc.bufnr, 1])
        doc = await workspace.document
        let content = doc.getDocumentContent()
        expect(content).toBe('}\n')
      })
    })

    it('should synchronize after force edit', async () => {
      await assertDocument(async doc => {
        let fsPath = URI.parse(doc.uri).fsPath
        fs.writeFileSync(fsPath, '{\n}\n', 'utf8')
        await nvim.command('edit')
        await nvim.call('deletebufline', [doc.bufnr, 1])
        doc = await workspace.document
        let content = doc.getDocumentContent()
        expect(content).toBe('}\n')
      })
    })
  })

  describe('applyEdits', () => {
    it('should synchronize content added', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo f')
      await doc.synchronize()
      await nvim.command('normal! ^2l')
      void nvim.input('ar')
      await doc.applyEdits([{
        range: Range.create(0, 0, 0, 5),
        newText: 'foo foo'
      }])
      await helper.waitFor('getline', ['.'], 'foor foo')
    })

    it('should synchronize content delete', async () => {
      let doc = await workspace.document
      await doc.buffer.setLines(['foo f'], { start: 0, end: -1, strictIndexing: false })
      await doc.synchronize()
      await nvim.command('normal! gg^2l')
      await nvim.input('a')
      await nvim.input('<backspace>')
      await helper.waitFor('getline', ['.'], 'fo f')
    })
  })

  describe('highlights', () => {
    it('should add highlights to document', async () => {
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
      expect(markers.length).toBe(2)
      nvim.pauseNotification()
      buf.clearNamespace('highlight')
      await nvim.resumeNotification()
      markers = await buf.getExtMarks(ns, 0, -1)
      expect(markers.length).toBe(0)
    })

    it('should add/clear highlights of current window', async () => {
      let buf = await nvim.buffer
      await buf.setLines(['你好', 'world'], { start: 0, end: -1, strictIndexing: false })
      let win = await nvim.window
      let ranges = [
        Range.create(0, 0, 0, 2),
        Range.create(1, 0, 1, 3)
      ]
      let res = await win.highlightRanges('Search', ranges)
      expect(res.length).toBe(2)
      let matches = await nvim.call('getmatches', [win.id]) as any
      expect(matches.length).toBe(2)
      nvim.pauseNotification()
      win.clearMatchGroup('Search')
      await nvim.resumeNotification()
      matches = await nvim.call('getmatches', [win.id])
      expect(matches.length).toBe(0)
    })

    it('should clear matches by ids', async () => {
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
      expect(matches.length).toBe(0)
    })
  })
})
