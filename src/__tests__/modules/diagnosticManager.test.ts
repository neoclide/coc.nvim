import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { severityLevel, getNameFromSeverity } from '../../diagnostic/util'
import { Range, DiagnosticSeverity, Diagnostic, Location } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Document from '../../model/document'
import workspace from '../../workspace'
import window from '../../window'
import manager from '../../diagnostic/manager'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
function createDiagnostic(msg: string, range?: Range, severity?: DiagnosticSeverity): Diagnostic {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Diagnostic.create(range, msg, severity || DiagnosticSeverity.Error)
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  manager.reset()
  await helper.reset()
})

async function createDocument(): Promise<Document> {
  let doc = await helper.createDocument()
  let collection = manager.create('test')
  let diagnostics: Diagnostic[] = []
  await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
    start: 0,
    end: -1,
    strictIndexing: false
  })
  diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error))
  diagnostics.push(createDiagnostic('warning', Range.create(0, 5, 0, 6), DiagnosticSeverity.Warning))
  diagnostics.push(createDiagnostic('information', Range.create(1, 0, 1, 1), DiagnosticSeverity.Information))
  diagnostics.push(createDiagnostic('hint', Range.create(1, 2, 1, 3), DiagnosticSeverity.Hint))
  diagnostics.push(createDiagnostic('error', Range.create(2, 0, 2, 2), DiagnosticSeverity.Error))
  collection.set(doc.uri, diagnostics)
  manager.refreshBuffer(doc.uri, true)
  doc.forceSync()
  return doc
}

describe('diagnostic manager', () => {
  describe('refresh', () => {
    it('should refresh on buffer create', async () => {
      let uri = URI.file(path.join(path.dirname(__dirname), 'doc')).toString()
      let fn = jest.fn()
      let disposable = manager.onDidRefresh(() => {
        fn()
      })
      let collection = manager.create('tmp')
      let diagnostic = createDiagnostic('My Error')
      collection.set(uri, [diagnostic])
      let doc = await helper.createDocument('doc')
      let val = await doc.buffer.getVar('coc_diagnostic_info') as any
      expect(fn).toBeCalled()
      expect(val).toBeDefined()
      expect(val.error).toBe(1)
      collection.dispose()
      disposable.dispose()
    })

    it('should refresh on InsertLeave', async () => {
      let doc = await helper.createDocument()
      await nvim.input('i')
      let collection = manager.create('test')
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error))
      collection.set(doc.uri, diagnostics)
      await helper.wait(30)
      await nvim.input('<esc>')
      await helper.wait(600)
    })

  })

  describe('getDiagnosticList', () => {
    it('should get all diagnostics', async () => {
      await createDocument()
      let list = manager.getDiagnosticList()
      expect(list).toBeDefined()
      expect(list.length).toBeGreaterThanOrEqual(5)
      expect(list[0].severity).toBe('Error')
      expect(list[1].severity).toBe('Error')
      expect(list[2].severity).toBe('Warning')
      expect(list[3].severity).toBe('Information')
      expect(list[4].severity).toBe('Hint')
    })
  })

  describe('create', () => {
    it('should create diagnostic collection', async () => {
      let doc = await helper.createDocument()
      let collection = manager.create('test')
      collection.set(doc.uri, [createDiagnostic('foo')])
      await helper.wait(100)
      let info = await doc.buffer.getVar('coc_diagnostic_info')
      expect(info).toBeDefined()
    })
  })

  describe('getSortedRanges', () => {
    it('should get sorted ranges of document', async () => {
      let doc = await helper.createDocument()
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      let collection = manager.create('test')
      let diagnostics: Diagnostic[] = []
      diagnostics.push(createDiagnostic('x', Range.create(0, 0, 0, 1)))
      diagnostics.push(createDiagnostic('y', Range.create(0, 1, 0, 2)))
      diagnostics.push(createDiagnostic('z', Range.create(1, 0, 1, 2)))
      collection.set(doc.uri, diagnostics)
      let ranges = manager.getSortedRanges(doc.uri)
      expect(ranges[0]).toEqual(Range.create(0, 0, 0, 1))
      expect(ranges[1]).toEqual(Range.create(0, 1, 0, 2))
      expect(ranges[2]).toEqual(Range.create(1, 0, 1, 2))
      ranges = manager.getSortedRanges(doc.uri, 'error')
      expect(ranges.length).toBe(3)
      expect(manager.getSortedRanges(doc.uri, 'warning').length).toBe(0)
    })
  })

  describe('getDiagnosticsInRange', () => {
    it('should get diagnostics in range', async () => {
      let doc = await helper.createDocument()
      let collection = manager.create('test')
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar foo bar', 'foo bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await helper.wait(300)
      diagnostics.push(createDiagnostic('a', Range.create(0, 0, 0, 1)))
      diagnostics.push(createDiagnostic('b', Range.create(0, 2, 0, 3)))
      diagnostics.push(createDiagnostic('c', Range.create(1, 0, 1, 2)))
      collection.set(doc.uri, diagnostics)
      let res = manager.getDiagnosticsInRange(doc.textDocument, Range.create(0, 0, 0, 3))
      expect(res.length).toBe(2)
    })
  })

  describe('getCurrentDiagnostics', () => {
    it('should get diagnostics under corsor', async () => {
      let config = workspace.getConfiguration('diagnostic')
      await createDocument()
      let diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBe(0)
      await nvim.call('cursor', [1, 4])
      diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBe(1)
      config.update('checkCurrentLine', true)
      await nvim.call('cursor', [1, 2])
      diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBe(2)
      config.update('checkCurrentLine', false)
    })

    it('should get empty diagnostic at end of line', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      manager.refreshBuffer(doc.bufnr, true)
      let diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(diagnostics[0].message).toBe('error')
      collection.dispose()
    })

    it('should get diagnostic next to end of line', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 0, 4), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      manager.refreshBuffer(doc.bufnr, true)
      let diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(diagnostics[0].message).toBe('error')
      collection.dispose()
    })

    it('should get diagnostic with empty range at end of line', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! $')
      let diagnostic = Diagnostic.create(Range.create(0, 3, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      manager.refreshBuffer(doc.bufnr, true)
      let diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(diagnostics[0].message).toBe('error')
      collection.dispose()
    })

    it('should get diagnostic pass end of the buffer lines', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo')
      doc.forceSync()
      await nvim.command('normal! ^')
      let diagnostic = Diagnostic.create(Range.create(1, 0, 1, 0), 'error', DiagnosticSeverity.Error)
      let collection = manager.create('empty')
      collection.set(doc.uri, [diagnostic])
      manager.refreshBuffer(doc.bufnr, true)
      let diagnostics = await manager.getCurrentDiagnostics()
      expect(diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(diagnostics[0].message).toBe('error')
      collection.dispose()
    })

  })

  describe('jumpRelated', () => {
    it('should jump to related position', async () => {
      let doc = await helper.createDocument()
      let range = Range.create(0, 0, 0, 10)
      let location = Location.create(URI.file(__filename).toString(), range)
      let diagnostic = Diagnostic.create(range, 'msg', DiagnosticSeverity.Error, 1000, 'test',
        [{ location, message: 'test' }])
      let collection = manager.create('positions')
      collection.set(doc.uri, [diagnostic])
      manager.refreshBuffer(doc.uri, true)
      await nvim.call('cursor', [1, 1])
      await manager.jumpRelated()
      await helper.wait(100)
      let bufname = await nvim.call('bufname', '%')
      expect(bufname).toMatch('diagnosticManager')
    })
  })

  describe('jumpPrevious & jumpNext', () => {
    it('should jump to previous', async () => {
      let doc = await createDocument()
      await nvim.command('normal! G$')
      let ranges = manager.getSortedRanges(doc.uri)
      ranges.reverse()
      for (let i = 0; i < ranges.length; i++) {
        await manager.jumpPrevious()
        let pos = await window.getCursorPosition()
        expect(pos).toEqual(ranges[i].start)
      }
    })

    it('should jump to next', async () => {
      let doc = await createDocument()
      await nvim.call('cursor', [0, 0])
      let ranges = manager.getSortedRanges(doc.uri)
      for (let i = 0; i < ranges.length; i++) {
        await manager.jumpNext()
        let pos = await window.getCursorPosition()
        expect(pos).toEqual(ranges[i].start)
      }
    })
  })

  describe('diagnostic configuration', () => {
    it('should show floating window on cursor hold', async () => {
      let config = workspace.getConfiguration('diagnostic')
      config.update('messageTarget', 'float')
      await createDocument()
      await nvim.call('cursor', [1, 3])
      await nvim.command('doautocmd CursorHold')
      let winid = await helper.waitFloat()
      let bufnr = await nvim.call('nvim_win_get_buf', winid) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      expect(lines.join('\n')).toMatch('error')
    })

    it('should echo messages on cursor hold', async () => {
      let config = workspace.getConfiguration('diagnostic')
      config.update('messageTarget', 'echo')
      await createDocument()
      await nvim.call('cursor', [1, 3])
      await helper.wait(600)
      let line = await helper.getCmdline()
      expect(line).toMatch('error')
      config.update('messageTarget', 'float')
    })

    it('should show diagnostics of current line', async () => {
      let config = workspace.getConfiguration('diagnostic')
      config.update('checkCurrentLine', true)
      await createDocument()
      await nvim.call('cursor', [1, 1])
      let winid = await helper.waitFloat()
      let bufnr = await nvim.call('nvim_win_get_buf', winid) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      expect(lines.length).toBe(3)
      config.update('checkCurrentLine', false)
    })

    it('should filter diagnostics by level', async () => {
      helper.updateConfiguration('diagnostic.level', 'warning')
      let doc = await createDocument()
      let diagnostics = manager.getDiagnostics(doc.uri)
      for (let diagnostic of diagnostics) {
        expect(diagnostic.severity != DiagnosticSeverity.Hint).toBe(true)
        expect(diagnostic.severity != DiagnosticSeverity.Information).toBe(true)
      }
      helper.updateConfiguration('diagnostic.level', 'hint')
    })

    it('should send ale diagnostic items', async () => {
      let config = workspace.getConfiguration('diagnostic')
      config.update('displayByAle', true)
      let content = `
    function! MockAleResults(bufnr, collection, items)
      let g:collection = a:collection
      let g:items = a:items
    endfunction
    `
      let file = await createTmpFile(content)
      await nvim.command(`source ${file}`)
      await createDocument()
      await helper.wait(100)
      let items = await nvim.getVar('items') as any[]
      expect(Array.isArray(items)).toBe(true)
      expect(items.length).toBeGreaterThan(0)
      let collection = manager.getCollectionByName('test')
      collection.clear()
      await helper.wait(100)
      items = await nvim.getVar('items') as any[]
      expect(items).toEqual([])
      config.update('displayByAle', false)
    })
  })

  describe('severityLevel & getNameFromSeverity', () => {
    it('should get severity level', () => {
      expect(severityLevel('hint')).toBe(DiagnosticSeverity.Hint)
      expect(severityLevel('error')).toBe(DiagnosticSeverity.Error)
      expect(severityLevel('warning')).toBe(DiagnosticSeverity.Warning)
      expect(severityLevel('information')).toBe(DiagnosticSeverity.Information)
      expect(severityLevel('')).toBe(DiagnosticSeverity.Hint)
    })

    it('should get severity name', () => {
      expect(getNameFromSeverity(null as any)).toBe('CocError')
    })
  })

  describe('toggleDiagnosticBuffer', () => {
    it('should toggle diagnostics for buffer', async () => {
      let doc = await createDocument()
      // required to wait refresh finish
      await helper.wait(50)
      manager.toggleDiagnosticBuffer(doc.bufnr)
      await helper.wait(50)
      let buf = nvim.createBuffer(doc.bufnr)
      let res = await buf.getVar('coc_diagnostic_info') as any
      expect(res == null).toBe(true)
      manager.toggleDiagnosticBuffer(doc.bufnr)
      await helper.wait(50)
      res = await buf.getVar('coc_diagnostic_info') as any
      expect(res.error).toBe(2)
    })
  })

  describe('refresh', () => {
    let config = workspace.getConfiguration('diagnostic')
    beforeEach(() => {
      config.update('autoRefresh', false)
    })
    afterEach(() => {
      config.update('autoRefresh', true)
    })

    it('should force refresh by bufnr', async () => {
      let doc = await createDocument()
      let buf = nvim.createBuffer(doc.bufnr)
      let res = await buf.getVar('coc_diagnostic_info') as any
      // should not refresh
      expect(res == null).toBe(true)
      manager.refresh(doc.bufnr)
      await helper.wait(100)
      res = await buf.getVar('coc_diagnostic_info') as any
      expect(res?.error).toBe(2)
    })

    it('should force refresh all buffers', async () => {
      let one = await helper.createDocument('one')
      let two = await helper.createDocument('two')
      let collection = manager.create('tmp')
      collection.set([[one.uri, [createDiagnostic('Error one')]], [two.uri, [createDiagnostic('Error two')]]])
      manager.refresh()
      await helper.wait(100)
      for (let bufnr of [one.bufnr, two.bufnr]) {
        let buf = nvim.createBuffer(bufnr)
        let res = await buf.getVar('coc_diagnostic_info') as any
        expect(res?.error).toBe(1)
      }
      collection.dispose()
    })
  })
})
