import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
  Location,
  Position,
  Range,
  TextEdit
} from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { DiagnosticBuffer } from '../../diagnostic/buffer'
import manager from '../../diagnostic/manager'
import {
  adjustDiagnostics,
  formatDiagnostic,
  getHighlightGroup,
  getLocationListItem,
  getMessageString,
  getNameFromSeverity,
  getSeverityName,
  getSeverityType,
  severityLevel,
  sortDiagnostics
} from '../../diagnostic/util'
import Document from '../../model/document'
import window from '../../window'
import commands from '../../commands'
import workspace from '../../workspace'
import fs from 'fs'
import { DidChangeTextDocumentParams } from '../../types'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let nvim: Neovim
function createDiagnostic(msg: string, range?: Range, severity?: DiagnosticSeverity): Diagnostic {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Diagnostic.create(range, msg, severity || DiagnosticSeverity.Error)
}

let virtualTextSrcId: number
before(async () => {
  nvim = workspace.nvim
  virtualTextSrcId = await nvim.createNamespace('coc-diagnostic-virtualText')
})

async function createDocument(name?: string): Promise<Document> {
  let doc = await shared.createDocument(name)
  let collection = manager.create('test')
  let diagnostics: Diagnostic[] = []
  await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
    start: 0,
    end: -1,
    strictIndexing: false
  })
  await doc.synchronize()
  diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error))
  diagnostics.push(createDiagnostic('warning', Range.create(0, 5, 0, 6), DiagnosticSeverity.Warning))
  diagnostics.push(createDiagnostic('information', Range.create(1, 0, 1, 1), DiagnosticSeverity.Information))
  diagnostics.push(createDiagnostic('hint', Range.create(1, 2, 1, 3), DiagnosticSeverity.Hint))
  diagnostics.push(createDiagnostic('error', Range.create(2, 0, 2, 2), DiagnosticSeverity.Error))
  collection.set(doc.uri, diagnostics)
  await shared.waitValue(() => {
    let buf = manager.getItem(doc.bufnr)
    if (!buf.config.autoRefresh) return true
    return buf.getDiagnosticsAt(Position.create(0, 0), true).length > 0
  }, true)
  return doc
}

afterEach(editorReset)

describe('diagnostic manager', () => {
  afterEach(() => {
    manager.reset()
  })
  describe('defineSigns', () => {
    it('should defineSigns', t => {
      manager.defineSigns({
        enableHighlightLineNumber: false
      })
    })
  })

  describe('setLocationlist()', () => {
    it('should set location list', async t => {
      let doc = await createDocument()
      await shared.doAction('fillDiagnostics', doc.bufnr)
      let res = await nvim.call('getloclist', [doc.bufnr]) as any[]
      assert.ok(res.length > 2)
      shared.updateConfiguration('diagnostic.locationlistLevel', 'error')
      await manager.setLocationlist(doc.bufnr)
      res = await nvim.call('getloclist', [doc.bufnr]) as any[]
      assert.strictEqual(res.length, 2)
    })

    it('should throw when buffer not attached', async t => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      let doc = await workspace.document
      let fn = async () => {
        await manager.setLocationlist(doc.bufnr)
      }
      await assert.rejects(fn(), /not/)
    })
  })

  describe('events', () => {
    it('should delay refresh when buffer visible', async t => {
      let doc = await shared.createDocument()
      await nvim.command('edit tmp')
      let collection = manager.create('foo')
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await doc.synchronize()
      diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error))
      collection.set(doc.uri, diagnostics)
      let buf = doc.buffer
      let val = await buf.getVar('coc_diagnostic_info') as any
      assert.strictEqual(val == null, true)
      let ns = await nvim.createNamespace('coc-diagnosticfoo')
      let markers = await buf.getExtMarks(ns, 0, -1)
      assert.strictEqual(markers.length, 0)
      await nvim.command(`b ${buf.id}`)
      await shared.waitFor('eval', ['empty(get(b:,"coc_diagnostic_info",{}))'], 0)
      collection.dispose()
    })

    it('should delay refresh on InsertLeave', async t => {
      let doc = await workspace.document
      await nvim.input('i')
      let collection = manager.create('foo')
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await doc.synchronize()
      diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error))
      collection.set(doc.uri, diagnostics)
      let buf = doc.buffer
      await shared.waitValue(async () => {
        let val = await buf.getVar('coc_diagnostic_info') as any
        return val == null
      }, true)
      let ns = await nvim.createNamespace('coc-diagnosticfoo')
      let markers = await buf.getExtMarks(ns, 0, -1)
      assert.strictEqual(markers.length, 0)
      await nvim.input('<esc>')
      await shared.waitValue(async () => {
        let markers = await buf.getExtMarks(ns, 0, -1)
        return markers.length
      }, 1)
    })

    it('should show diagnostic virtual text on CursorMoved', async t => {
      shared.updateConfiguration('diagnostic.virtualText', true)
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', true)
      let doc = await createDocument()
      await shared.waitValue(async () => (await doc.buffer.getExtMarks(virtualTextSrcId, 0, -1, { details: true })).length > 0, true)
      let markers = await doc.buffer.getExtMarks(virtualTextSrcId, 0, -1, { details: true })
      await manager.toggleDiagnosticBuffer(doc.bufnr)
      await nvim.call('cursor', [1, 3])
      await shared.waitValue(async () => (await doc.buffer.getExtMarks(virtualTextSrcId, 0, -1, { details: true })).length, 0)
      markers = await doc.buffer.getExtMarks(virtualTextSrcId, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
    })
  })

  describe('refresh()', () => {
    it('should refresh on buffer create', async t => {
      let uri = URI.file(path.join(path.dirname(import.meta.dirname), 'doc')).toString()
      let fn = t.mock.fn()
      let disposable = manager.onDidRefresh(() => {
        fn()
      })
      let collection = manager.create('tmp')
      let diagnostic = createDiagnostic('My Error')
      collection.set(uri, [diagnostic])
      // Create the document at the same absolute path the URI was derived
      // shared.createDocument resolves relative names against the nvim cwd
      // (build tree), while import.meta.dirname here points at the source tree.
      let doc = await shared.createDocument(path.join(path.dirname(import.meta.dirname), 'doc'))
      await shared.waitValue(() => fn.mock.calls.length, 1)
      let val = await doc.buffer.getVar('coc_diagnostic_info') as any
      assert.ok(fn.mock.calls.length > 0)
      assert.notStrictEqual(val, undefined)
      assert.strictEqual(val.error, 1)
      collection.dispose()
      disposable.dispose()
    })
  })

  describe('toggleDiagnostic()', () => {
    it('should toggle diagnostics for all buffer', async t => {
      await createDocument()
      let doc = await createDocument()
      await shared.doAction('diagnosticToggle')
      let item = manager.getItem(doc.bufnr)
      assert.strictEqual(item.config.enable, false)
      await manager.toggleDiagnostic(1)
      assert.strictEqual(item.config.enable, true)
    })
  })

  describe('getDiagnosticList()', () => {
    it('should get all diagnostics', async t => {
      await createDocument()
      let collection = manager.create('test')
      let fsPath = await shared.createTmpFile('foo')
      let doc = await shared.createDocument(fsPath)
      let diagnostics: Diagnostic[] = []
      diagnostics.push(createDiagnostic('error', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error))
      diagnostics.push(createDiagnostic('error', Range.create(0, 1, 0, 2), DiagnosticSeverity.Error))
      diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 3), DiagnosticSeverity.Warning))
      collection.set(doc.uri, diagnostics)
      collection.set('file:///1', [])
      let list = await shared.doAction('diagnosticList')
      assert.notStrictEqual(list, undefined)
      assert.ok(list.length >= 5)
      assert.strictEqual(list[0].severity, 'Error')
      assert.strictEqual(list[1].severity, 'Error')
      assert.strictEqual(list[2].severity, 'Error')
    })

    it('should filter diagnostics by configuration', async t => {
      shared.updateConfiguration('diagnostic.level', 'warning')
      shared.updateConfiguration('diagnostic.showUnused', false)
      shared.updateConfiguration('diagnostic.showDeprecated', false)
      let doc = await createDocument()
      let buf = manager.getItem(doc.bufnr)
      let diagnostics = manager.getDiagnostics(buf)['test']
      diagnostics[0].tags = [DiagnosticTag.Unnecessary]
      diagnostics[2].tags = [DiagnosticTag.Deprecated]
      let list = await manager.getDiagnosticList()
      assert.strictEqual(list.length, 3)
      let res = manager.getDiagnostics(buf)['test']
      assert.strictEqual(res.length, 1)
      let ranges = manager.getSortedRanges(doc.uri, buf.config.level)
      assert.strictEqual(ranges.length, 3)
    })

    it('should load file from disk', async t => {
      let fsPath = import.meta.filename
      let collection = manager.create('test')
      let diagnostics: Diagnostic[] = []
      diagnostics.push(createDiagnostic('error', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error))
      let uri = URI.file(fsPath).toString()
      collection.set(uri, diagnostics)
      let arr: Diagnostic[] = []
      arr.push(createDiagnostic('error', Range.create(1, 0, 1, 1), undefined))
      collection.set('test:1', arr)
      let list = await manager.getDiagnosticList()
      assert.strictEqual(list.length, 2)
    })
  })

  describe('preview()', () => {
    it('should not throw with empty diagnostics', async t => {
      await shared.doAction('diagnosticPreview')
      let tabpage = await nvim.tabpage
      let wins = await tabpage.windows
      assert.strictEqual(wins.length, 1)
    })

    it('should open preview window', async t => {
      await createDocument()
      await nvim.call('cursor', [1, 3])
      await manager.preview()
      let res = await nvim.call('coc#window#find', ['&previewwindow', 1])
      assert.notStrictEqual(res, undefined)
    })
  })

  describe('setConfigurationErrors()', () => {
    it('should set configuration errors on refresh', async t => {
      let file = path.join(os.tmpdir(), '69075963-48d6-4427-92db-287a09d5e976')
      fs.writeFileSync(file, ']', 'utf8')
      workspace.configurations.parseConfigurationModel(file)
      let errors = workspace.configurations.errors
      assert.ok(errors.size > 0)
      let list = await manager.getDiagnosticList()
      assert.strictEqual(list.length, 1)
      assert.strictEqual(list[0].file, file)
      manager.checkConfigurationErrors()
      fs.unlinkSync(file)
    })
  })

  describe('create()', () => {
    it('should create diagnostic collection', async t => {
      let doc = await workspace.document
      let collection = manager.create('test')
      collection.set(doc.uri, [createDiagnostic('foo')])
      await shared.waitValue(async () => {
        let info = await doc.buffer.getVar('coc_diagnostic_info')
        return info != null
      }, true)
    })
  })

  describe('getSortedRanges()', () => {
    it('should get sorted ranges of document', async t => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      let collection = manager.create('test')
      let diagnostics: Diagnostic[] = []
      diagnostics.push(createDiagnostic('x', Range.create(0, 0, 0, 1)))
      diagnostics.push(createDiagnostic('y', Range.create(0, 1, 0, 2)))
      diagnostics.push(createDiagnostic('z', Range.create(1, 0, 1, 2)))
      collection.set(doc.uri, diagnostics)
      let item = manager.getItem(doc.bufnr)
      let level = item.config.level
      let ranges = manager.getSortedRanges(doc.uri, level)
      assert.deepStrictEqual(ranges[0], Range.create(0, 0, 0, 1))
      assert.deepStrictEqual(ranges[1], Range.create(0, 1, 0, 2))
      assert.deepStrictEqual(ranges[2], Range.create(1, 0, 1, 2))
      ranges = manager.getSortedRanges(doc.uri, level, 'error')
      assert.strictEqual(ranges.length, 3)
      assert.strictEqual(manager.getSortedRanges(doc.uri, level, 'warning').length, 0)
    })
  })

  describe('getDiagnosticsInRange', () => {
    it('should get diagnostics in range', async t => {
      let doc = await createDocument()
      let res = manager.getDiagnosticsInRange(doc.textDocument, Range.create(0, 0, 1, 0))
      assert.strictEqual(res.length, 3)
      doc = await shared.createDocument()
      res = manager.getDiagnosticsInRange(doc.textDocument, Range.create(0, 0, 1, 0))
      assert.strictEqual(res.length, 0)
    })
  })

  describe('getCurrentDiagnostics', () => {
    it('should get undefined when buffer not attached', async t => {
      await nvim.command(`edit +setl\\ buftype=nofile tmp`)
      let res = await manager.getCurrentDiagnostics()
      await shared.doAction('diagnosticInfo')
      assert.strictEqual(res, undefined)
    })

    it('should get diagnostics under cursor', async t => {
      await createDocument()
      let diagnostics = await manager.getCurrentDiagnostics()
      assert.strictEqual(diagnostics.length, 0)
      await nvim.call('cursor', [1, 4])
      diagnostics = await manager.getCurrentDiagnostics()
      assert.strictEqual(diagnostics.length, 1)
      shared.updateConfiguration('diagnostic.checkCurrentLine', true)
      await nvim.call('cursor', [1, 2])
      diagnostics = await manager.getCurrentDiagnostics()
      assert.strictEqual(diagnostics.length, 2)
    })

    it('should get empty diagnostic at end of line', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.bufnr)
      let diagnostics = await manager.getCurrentDiagnostics()
      assert.ok(diagnostics.length >= 1)
      assert.strictEqual(diagnostics[0].message, 'error')
      collection.dispose()
      await manager.refreshBuffer(99)
    })

    it('should get diagnostic next to end of line', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 0, 4), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.bufnr)
      let diagnostics = await manager.getCurrentDiagnostics()
      assert.ok(diagnostics.length >= 1)
      assert.strictEqual(diagnostics[0].message, 'error')
      collection.dispose()
    })

    it('should get diagnostic with empty range at end of line', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.bufnr)
      let diagnostics = await manager.getCurrentDiagnostics()
      assert.ok(diagnostics.length >= 1)
      assert.strictEqual(diagnostics[0].message, 'error')
      collection.dispose()
    })

    it('should get diagnostic pass end of the buffer lines', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! ^')
      let diagnostic = Diagnostic.create(Range.create(1, 0, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.bufnr)
      let diagnostics = await manager.getCurrentDiagnostics()
      assert.ok(diagnostics.length >= 1)
      assert.strictEqual(diagnostics[0].message, 'error')
      collection.dispose()
    })

  })

  describe('jumpRelated', () => {
    it('should does nothing when no diagnostic exists', async t => {
      let doc = await workspace.document
      await nvim.call('cursor', [1, 1])
      await commands.executeCommand('workspace.diagnosticRelated')
      let bufnr = await nvim.eval('bufnr("%")')
      assert.strictEqual(bufnr, doc.bufnr)
    })

    it('should does nothing when no related information exists', async t => {
      let doc = await createDocument()
      await nvim.call('cursor', [1, 4])
      await manager.jumpRelated()
      let bufnr = await nvim.eval('bufnr("%")')
      assert.strictEqual(bufnr, doc.bufnr)
    })

    it('should jump to related position', async t => {
      let doc = await workspace.document
      let range = Range.create(0, 0, 0, 10)
      let location = Location.create(URI.file(import.meta.filename).toString(), range)
      let diagnostic = Diagnostic.create(range, 'msg', DiagnosticSeverity.Error, 1000, 'test',
        [{ location, message: 'test' }])
      let collection = manager.create('positions')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.uri)
      await nvim.call('cursor', [1, 1])
      await manager.jumpRelated()
      let bufname = await nvim.call('bufname', '%')
      assert.match(String(bufname), new RegExp('diagnosticManager'))
    })

    it('should open location list', async t => {
      let doc = await workspace.document
      let range = Range.create(0, 0, 0, 10)
      let diagnostic = Diagnostic.create(range, 'msg', DiagnosticSeverity.Error, 1000, 'test',
        [{
          location: Location.create(URI.file(import.meta.filename).toString(), Range.create(1, 0, 1, 10)),
          message: 'foo'
        }, {
          location: Location.create(URI.file(import.meta.filename).toString(), Range.create(2, 0, 2, 10)),
          message: 'bar'
        }])
      let collection = manager.create('positions')
      collection.set(doc.uri, [diagnostic])
      await manager.refreshBuffer(doc.uri)
      await nvim.call('cursor', [1, 1])
      await manager.jumpRelated()
      await shared.waitFor('bufname', ['%'], 'list:///location')
      await nvim.input('<esc>')
    })
  })

  describe('jumpPrevious & jumpNext', () => {
    it('should jump to previous', async t => {
      let doc = await createDocument()
      await nvim.command('normal! G$')
      let ranges = manager.getSortedRanges(doc.uri, undefined)
      ranges.reverse()
      for (let i = 0; i < ranges.length; i++) {
        await manager.jumpPrevious()
        let pos = await window.getCursorPosition()
        assert.deepStrictEqual(pos, ranges[i].start)
      }
      await shared.doAction('diagnosticPrevious')
    })

    it('should jump to next', async t => {
      let doc = await createDocument()
      await nvim.call('cursor', [0, 0])
      let ranges = manager.getSortedRanges(doc.uri, undefined)
      for (let i = 0; i < ranges.length; i++) {
        await manager.jumpNext()
        let pos = await window.getCursorPosition()
        assert.deepStrictEqual(pos, ranges[i].start)
      }
      await shared.doAction('diagnosticNext')
    })

    it('should consider invalid position', async t => {
      let doc = await shared.createDocument('foo.js')
      let collection = manager.create('foo')
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar', '', 'foo', 'bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await nvim.call('cursor', [2, 0])
      await doc.synchronize()
      diagnostics.push(createDiagnostic('error', Range.create(0, 1, 0, 2), DiagnosticSeverity.Error))
      diagnostics.push(createDiagnostic('warning', Range.create(1, 1, 1, 1), DiagnosticSeverity.Warning))
      diagnostics.push(createDiagnostic('warning', Range.create(2, 1, 2, 1), DiagnosticSeverity.Warning))
      collection.set(doc.uri, diagnostics)
      await manager.jumpNext()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, Position.create(2, 1))
    })

    it('should not throw when buffer not attached', async t => {
      let doc = await workspace.document
      await manager.jumpNext()
      await nvim.command('edit foo | setl buftype=nofile')
      doc = await workspace.document
      assert.strictEqual(doc.attached, false)
      await manager.jumpNext()
    })

    it('should respect wrapscan', async t => {
      await createDocument()
      await nvim.command('setl nowrapscan')
      await nvim.command('normal! G$')
      await manager.jumpNext()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 3, character: 2 })
      await nvim.command('normal! gg0')
      await manager.jumpPrevious()
      pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 0 })
    })
  })

  describe('diagnostic configuration', () => {
    it('should use filetype map from config', async t => {
      shared.updateConfiguration('diagnostic.filetypeMap', { default: 'bufferType' })
      shared.updateConfiguration('diagnostic.messageDelay', 10)
      let doc = await createDocument('foo.js')
      await nvim.setLine('foo')
      await doc.synchronize()
      let collection = manager.getCollectionByName('test')
      let diagnostic = createDiagnostic('99', Range.create(0, 0, 0, 3), DiagnosticSeverity.Error)
      diagnostic.codeDescription = {
        href: 'http://www.example.com'
      }
      let diagnostics = [diagnostic]
      collection.set(doc.uri, diagnostics)
      await nvim.call('cursor', [1, 2])
      await manager.echoCurrentMessage()
      let win = await shared.getFloat()
      let bufnr = await nvim.call('winbufnr', [win.id]) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      assert.match(lines.join('\n'), new RegExp('www\\.example\\.com'))
    })

    it('should show floating window on cursor hold', async t => {
      shared.updateConfiguration('diagnostic.messageTarget', 'float')
      shared.updateConfiguration('diagnostic.messageDelay', 10)
      await createDocument()
      await nvim.call('cursor', [1, 3])
      let winid = await shared.waitFloat()
      let bufnr = await nvim.call('nvim_win_get_buf', winid) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      assert.match(lines.join('\n'), new RegExp('error'))
    })

    it('should filter diagnostics by messageLevel', async t => {
      shared.updateConfiguration('diagnostic.messageLevel', 'error')
      shared.updateConfiguration('diagnostic.messageTarget', 'echo')
      await createDocument()
      await nvim.call('cursor', [1, 6])
      await manager.echoCurrentMessage()
      let line = await shared.getCmdline()
      assert.strictEqual(line.indexOf('warning'), -1)
    })

    it('should echo messages on CursorHold', async t => {
      shared.updateConfiguration('diagnostic.messageTarget', 'echo')
      await createDocument()
      await nvim.call('cursor', [1, 3])
      await shared.waitValue(async () => {
        let line = await shared.getCmdline()
        return line.length > 0
      }, true)
    })

    it('should not echo messages on CursorHold', async t => {
      await nvim.command('echo ""')
      shared.updateConfiguration('diagnostic.enableMessage', 'never')
      await createDocument()
      await nvim.call('cursor', [1, 3])
      await shared.wait(30)
      let line = await shared.getCmdline()
      assert.strictEqual(line, '')
    })

    it('should show diagnostics of current line', async t => {
      shared.updateConfiguration('diagnostic.checkCurrentLine', true)
      await createDocument()
      await nvim.call('cursor', [1, 3])
      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      assert.strictEqual(lines.length, 3)
    })

    it('should filter diagnostics by level', async t => {
      shared.updateConfiguration('diagnostic.level', 'warning')
      let doc = await createDocument()
      let item = manager.getItem(doc.bufnr)
      let diagnosticsMap = manager.getDiagnostics(item)
      for (let diagnostics of Object.values(diagnosticsMap)) {
        for (let diagnostic of diagnostics) {
          assert.strictEqual(diagnostic.severity != DiagnosticSeverity.Hint, true)
          assert.strictEqual(diagnostic.severity != DiagnosticSeverity.Information, true)
        }
      }
    })

    it('should send ale diagnostic items', async t => {
      shared.updateConfiguration('diagnostic.displayByAle', true)
      let content = `
    function! MockAleResults(bufnr, collection, items)
      let g:collection = a:collection
      let g:items = a:items
    endfunction
    `
      let file = await shared.createTmpFile(content)
      await nvim.command(`source ${file}`)
      await createDocument()
      await shared.waitValue(async () => {
        let items = await nvim.getVar('items') as any
        return Array.isArray(items)
      }, true)
      await nvim.command('bd!')
      await shared.waitFor('eval', ['get(g:,"items",[])'], [])
    })

    it('should send to vim.diagnostic', async t => {
      shared.updateConfiguration('diagnostic.displayByVimDiagnostic', true)

      let doc = await createDocument()
      let buf = nvim.createBuffer(doc.bufnr)
      let items: any
      await shared.waitValue(async () => {
        items = await buf.getVar('coc_diagnostic_map') as any
        return Array.isArray(items) && items.length == 5
      }, true)
      assert.strictEqual(items.length, 5)

      let res = await nvim.lua('return vim.diagnostic.get()') as any[]
      assert.strictEqual(res.length, 5)
      assert.strictEqual(res[0].severity, 1)
      assert.strictEqual(res[0].message, 'error')
      assert.strictEqual(res[1].source, 'test')
    })
  })

  describe('diagnostic util', () => {
    it('should get message string', t => {
      assert.strictEqual(getMessageString('plain text'), 'plain text')
      assert.strictEqual(getMessageString({ kind: 'markdown', value: '**markdown**' }), '**markdown**')
    })

    it('should format diagnostic', t => {
      let diagnostic: Diagnostic = {
        range: Range.create(0, 0, 0, 1),
        message: { kind: 'markdown', value: 'Use $& literally' },
        severity: DiagnosticSeverity.Warning,
        source: 'eslint',
        code: 'no-foo'
      }

      assert.strictEqual(formatDiagnostic('%source%code [%severity] %message', diagnostic), 'eslint no-foo [W] Use $& literally')

      diagnostic.code = undefined
      diagnostic.message = 'plain text'
      assert.strictEqual(formatDiagnostic('%severity:%message%code', diagnostic), 'W:plain text')
    })

    it('should format diagnostic with zero code', t => {
      let diagnostic: Diagnostic = {
        range: Range.create(0, 0, 0, 1),
        message: 'message',
        severity: DiagnosticSeverity.Error,
        source: 'test',
        code: 0
      }

      assert.strictEqual(formatDiagnostic('%source%code %message', diagnostic), 'test 0 message')
    })

    it('should get severity level', t => {
      assert.strictEqual(severityLevel(null), undefined)
      assert.strictEqual(severityLevel(undefined), undefined)
      assert.strictEqual(severityLevel('hint'), DiagnosticSeverity.Hint)
      assert.strictEqual(severityLevel('error'), DiagnosticSeverity.Error)
      assert.strictEqual(severityLevel('warning'), DiagnosticSeverity.Warning)
      assert.strictEqual(severityLevel('information'), DiagnosticSeverity.Information)
      assert.strictEqual(severityLevel(''), DiagnosticSeverity.Hint)
    })

    it('should get Coc severity name', t => {
      assert.strictEqual(getNameFromSeverity(null as any), 'CocError')
      assert.strictEqual(getNameFromSeverity(DiagnosticSeverity.Error), 'CocError')
      assert.strictEqual(getNameFromSeverity(DiagnosticSeverity.Warning), 'CocWarning')
      assert.strictEqual(getNameFromSeverity(DiagnosticSeverity.Information), 'CocInfo')
      assert.strictEqual(getNameFromSeverity(DiagnosticSeverity.Hint), 'CocHint')
    })

    it('should get severity name', t => {
      assert.strictEqual(getSeverityName(DiagnosticSeverity.Error), 'Error')
      assert.strictEqual(getSeverityName(DiagnosticSeverity.Warning), 'Warning')
      assert.strictEqual(getSeverityName(DiagnosticSeverity.Information), 'Information')
      assert.strictEqual(getSeverityName(DiagnosticSeverity.Hint), 'Hint')
      assert.strictEqual(getSeverityName(99 as DiagnosticSeverity), 'Error')
    })

    it('should get severity type', t => {
      assert.strictEqual(getSeverityType(DiagnosticSeverity.Error), 'E')
      assert.strictEqual(getSeverityType(DiagnosticSeverity.Warning), 'W')
      assert.strictEqual(getSeverityType(DiagnosticSeverity.Information), 'I')
      assert.strictEqual(getSeverityType(DiagnosticSeverity.Hint), 'I')
      assert.strictEqual(getSeverityType(99 as DiagnosticSeverity), 'E')
    })

    it('should sort diagnostics', t => {
      let diagnostics: Diagnostic[] = [
        { range: Range.create(1, 0, 1, 10), message: 'a', severity: DiagnosticSeverity.Warning },
        { range: Range.create(0, 0, 0, 10), message: 'b', severity: DiagnosticSeverity.Error },
        { range: Range.create(0, 0, 0, 10), message: 'c', severity: DiagnosticSeverity.Error, source: 'c' },
        { range: Range.create(0, 0, 0, 10), message: 'd', severity: DiagnosticSeverity.Error, source: 'd' },
      ]
      diagnostics.sort(sortDiagnostics)
      assert.deepStrictEqual(diagnostics.map(d => d.message), ['c', 'd', 'b', 'a'])
    })

    it('should sort diagnostics by position', t => {
      let diagnostics: Diagnostic[] = [
        { range: Range.create(1, 1, 1, 2), message: 'b', severity: DiagnosticSeverity.Error },
        { range: Range.create(0, 1, 0, 2), message: 'a' },
        { range: Range.create(1, 0, 1, 1), message: 'c', severity: DiagnosticSeverity.Error },
      ]
      diagnostics.sort(sortDiagnostics)
      assert.deepStrictEqual(diagnostics.map(d => d.message), ['a', 'c', 'b'])
    })

    it('should get location list item', t => {
      let diagnostic: Diagnostic = {
        range: Range.create(0, 1, 1, 2),
        message: 'first line\nsecond line',
        severity: DiagnosticSeverity.Information,
        source: 'tsserver',
        code: 'TS1000'
      }
      let item = getLocationListItem(3, diagnostic, ['abcd', 'efgh'])

      assert.deepStrictEqual(item, {
        bufnr: 3,
        lnum: 1,
        end_lnum: 2,
        col: 2,
        end_col: 3,
        text: '[tsserver TS1000] first line [I]',
        type: 'I'
      })
    })

    it('should get location list item with defaults and bytes index', t => {
      let diagnostic: Diagnostic = {
        range: Range.create(0, 1, 0, 2),
        message: { kind: 'markdown', value: 'markdown message\nnext line' },
        severity: DiagnosticSeverity.Warning
      }
      let item = getLocationListItem(1, diagnostic, ['你a'])

      assert.deepStrictEqual(item, {
        bufnr: 1,
        lnum: 1,
        end_lnum: 1,
        col: 4,
        end_col: 5,
        text: '[coc.nvim] markdown message [W]',
        type: 'W'
      })

      item = getLocationListItem(1, diagnostic)
      assert.strictEqual(item.col, 2)
      assert.strictEqual(item.end_col, 3)
    })

    it('should get highlight group', t => {
      let diagnostic: Diagnostic = {
        range: Range.create(0, 0, 0, 10),
        message: 'error message',
        severity: DiagnosticSeverity.Error,
        tags: [DiagnosticTag.Deprecated, DiagnosticTag.Unnecessary]
      }
      let groups = getHighlightGroup(diagnostic)
      assert.ok((groups as string[]).includes('CocDeprecatedHighlight'))
      assert.ok((groups as string[]).includes('CocUnusedHighlight'))
      assert.ok((groups as string[]).includes('CocErrorHighlight'))
    })

    it('should get highlight group by severity', t => {
      let diagnostic = Diagnostic.create(Range.create(0, 0, 0, 1), 'message', DiagnosticSeverity.Warning)
      assert.deepStrictEqual(getHighlightGroup(diagnostic), ['CocWarningHighlight'])

      diagnostic.severity = DiagnosticSeverity.Information
      assert.deepStrictEqual(getHighlightGroup(diagnostic), ['CocInfoHighlight'])

      diagnostic.severity = DiagnosticSeverity.Hint
      assert.deepStrictEqual(getHighlightGroup(diagnostic), ['CocHintHighlight'])
    })

    it('should get highlight group without severity', t => {
      let diagnostic = Diagnostic.create(Range.create(0, 0, 0, 1), 'message')
      assert.deepStrictEqual(getHighlightGroup(diagnostic), [])

      diagnostic.tags = [DiagnosticTag.Unnecessary]
      assert.deepStrictEqual(getHighlightGroup(diagnostic), ['CocUnusedHighlight'])
    })

    it('should adjust diagnostics with text edit', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 1), 'before', DiagnosticSeverity.Hint),
        Diagnostic.create(Range.create(0, 3, 0, 5), 'overlap', DiagnosticSeverity.Error),
        Diagnostic.create(Range.create(1, 0, 1, 2), 'after', DiagnosticSeverity.Warning)
      ]
      let edit = TextEdit.replace(Range.create(0, 2, 0, 4), 'a\nb')
      let result = adjustDiagnostics(diagnostics, edit)

      assert.deepStrictEqual(result.map(o => o.message), ['before', 'after'])
      assert.deepStrictEqual(result[1].range, Range.create(2, 0, 2, 2))
    })

    it('should adjust diagnostic character for same line edit', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 1), 'before'),
        Diagnostic.create(Range.create(0, 3, 0, 5), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 1), 'xy'))

      assert.deepStrictEqual(result.map(o => o.message), ['before', 'after'])
      assert.deepStrictEqual(result[0].range, Range.create(0, 0, 0, 1))
      assert.deepStrictEqual(result[1].range, Range.create(0, 5, 0, 7))
    })

    it('should not mutate original diagnostics', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 1), 'before'),
        Diagnostic.create(Range.create(0, 3, 0, 5), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 1), 'xy'))

      assert.deepStrictEqual(result.map(o => o.message), ['before', 'after'])
      assert.deepStrictEqual(result[1].range, Range.create(0, 5, 0, 7))
      assert.deepStrictEqual(diagnostics[1].range, Range.create(0, 3, 0, 5))
      assert.strictEqual(result[0], diagnostics[0])
      assert.notStrictEqual(result[1], diagnostics[1])
    })

    it('should return same array when edit not affects diagnostics', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 1), 'before'),
        Diagnostic.create(Range.create(0, 3, 0, 5), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 8), 'xy'))

      assert.strictEqual(result, diagnostics)
    })

    it('should drop diagnostic overlapping edit after later start', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 100), 'long'),
        Diagnostic.create(Range.create(0, 3, 0, 5), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.replace(Range.create(0, 8, 0, 9), 'x'))

      assert.deepStrictEqual(result.map(o => o.message), ['after'])
    })

    it('should return same empty array for empty diagnostics', t => {
      let diagnostics: Diagnostic[] = []
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 1), 'x'))

      assert.strictEqual(result, diagnostics)
    })

    it('should shift all diagnostics for edit before them', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 3, 0, 5), 'a'),
        Diagnostic.create(Range.create(0, 6, 0, 8), 'b')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 0), 'xy'))

      assert.deepStrictEqual(result[0].range, Range.create(0, 5, 0, 7))
      assert.deepStrictEqual(result[1].range, Range.create(0, 8, 0, 10))
      assert.notStrictEqual(result[0], diagnostics[0])
      assert.deepStrictEqual(diagnostics[0].range, Range.create(0, 3, 0, 5))
    })

    it('should shift lines for multiline edit above diagnostics', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(1, 0, 1, 2), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 0), 'a\nb\n'))

      assert.deepStrictEqual(result[0].range, Range.create(3, 0, 3, 2))
    })

    it('should shift lines back when lines are removed above', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(3, 0, 3, 2), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.replace(Range.create(0, 0, 2, 0), ''))

      assert.deepStrictEqual(result[0].range, Range.create(1, 0, 1, 2))
    })

    it('should not adjust diagnostic starting at edit end', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 2, 0, 4), 'boundary')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.insert(Position.create(0, 2), 'x'))

      assert.strictEqual(result, diagnostics)
    })

    it('should not adjust diagnostic ending at edit start', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 0, 0, 2), 'boundary')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.replace(Range.create(0, 2, 0, 4), 'x'))

      assert.strictEqual(result, diagnostics)
    })

    it('should drop multiline diagnostic inside edit and shift after', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 2, 1, 2), 'inside'),
        Diagnostic.create(Range.create(1, 5, 1, 6), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.replace(Range.create(0, 1, 1, 4), 'x'))

      assert.deepStrictEqual(result.map(o => o.message), ['after'])
      assert.deepStrictEqual(result[0].range, Range.create(0, 3, 0, 4))
    })

    it('should adjust character on edit end line for multiline replacement', t => {
      let diagnostics: Diagnostic[] = [
        Diagnostic.create(Range.create(0, 4, 0, 6), 'after')
      ]
      let result = adjustDiagnostics(diagnostics, TextEdit.replace(Range.create(0, 1, 0, 3), 'x\ny'))

      assert.deepStrictEqual(result[0].range, Range.create(1, 2, 1, 4))
    })
  })

  describe('text change adjustment', () => {
    function createChange(buf: DiagnosticBuffer, version: number, range: Range, text: string): DidChangeTextDocumentParams {
      let doc = buf.doc
      return {
        textDocument: { version, uri: doc.uri },
        document: doc.textDocument,
        contentChanges: [{ range, text }],
        bufnr: doc.bufnr,
        original: doc.textDocument.getText(),
        originalLines: doc.textDocument.lines
      }
    }

    it('should adjust buffer diagnostics without mutating collection', async t => {
      let doc = await createDocument()
      let buf = manager.getItem(doc.bufnr)
      let collection = manager.create('test')
      buf.onChange(createChange(buf, 1, Range.create(0, 0, 0, 0), 'xy'))
      buf.refreshHighlights.clear()
      let adjusted = buf['diagnosticsMap'].get('test')

      assert.deepStrictEqual(adjusted[0].range, Range.create(0, 4, 0, 6))
      assert.deepStrictEqual(adjusted[1].range, Range.create(0, 7, 0, 8))
      assert.deepStrictEqual(adjusted[2].range, Range.create(1, 0, 1, 1))
      let originals = collection.get(doc.uri)
      assert.deepStrictEqual(originals[0].range, Range.create(0, 2, 0, 4))
      assert.deepStrictEqual(originals[1].range, Range.create(0, 5, 0, 6))
      assert.deepStrictEqual(originals[2].range, Range.create(1, 0, 1, 1))
    })
  })

  describe('toggleDiagnosticBuffer', () => {
    it('should not throw when bufnr is invliad or disabled', async t => {
      let doc = await workspace.document
      await shared.doAction('diagnosticToggleBuffer', 99)
      shared.updateConfiguration('diagnostic.enable', false)
      await manager.toggleDiagnosticBuffer(doc.bufnr)
    })

    it('should toggle current buffer', async t => {
      let doc = await workspace.document
      await manager.toggleDiagnosticBuffer()
      let buf = nvim.createBuffer(doc.bufnr)
      let res = await buf.getVar('coc_diagnostic_disable') as any
      assert.strictEqual(res, 1)
    })

    it('should toggle diagnostics for buffer', async t => {
      let doc = await createDocument()
      await manager.toggleDiagnosticBuffer(doc.bufnr)
      let buf = nvim.createBuffer(doc.bufnr)
      let res = await buf.getVar('coc_diagnostic_info') as any
      assert.strictEqual(res == null, true)
      await manager.toggleDiagnosticBuffer(doc.bufnr, 1)
      res = await buf.getVar('coc_diagnostic_info') as any
      assert.strictEqual(res.error, 2)
    })
  })

  describe('refresh', () => {
    beforeEach(() => {
      shared.updateConfiguration('diagnostic.autoRefresh', false)
    })

    it('should refresh by bufnr', async t => {
      let doc = await createDocument()
      let buf = nvim.createBuffer(doc.bufnr)
      let res = await buf.getVar('coc_diagnostic_info') as any
      // should not refresh
      assert.strictEqual(res == null, true)
      await manager.refresh(doc.bufnr)
      await shared.waitValue(async () => {
        let res = await buf.getVar('coc_diagnostic_info') as any
        return res?.error
      }, 2)
      await manager.refresh(99)
    })

    it('should refresh all buffers', async t => {
      let uris = ['one', 'two'].map(s => URI.file(path.join(os.tmpdir(), s)).toString())
      await workspace.loadFile(uris[0], 'tabe')
      await workspace.loadFile(uris[1], 'tabe')
      let collection = manager.create('tmp')
      collection.set([[uris[0], [createDiagnostic('Error one')]], [uris[1], [createDiagnostic('Error two')]]])
      await shared.doAction('diagnosticRefresh')
      let bufnrs = [workspace.getDocument(uris[0]).bufnr, workspace.getDocument(uris[1]).bufnr]
      for (let bufnr of bufnrs) {
        let buf = nvim.createBuffer(bufnr)
        let res = await buf.getVar('coc_diagnostic_info') as any
        assert.strictEqual(res?.error, 1)
      }
      collection.dispose()
    })
  })
})
