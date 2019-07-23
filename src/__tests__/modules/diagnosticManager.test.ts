import { Neovim } from '@chemzqm/neovim'
import { severityLevel, getNameFromSeverity } from '../../diagnostic/util'
import { Range, DiagnosticSeverity, Diagnostic, Location } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Document from '../../model/document'
import workspace from '../../workspace'
import manager from '../../diagnostic/manager'
import helper from '../helper'

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
  await helper.wait(200)
  let buf = manager.buffers.find(b => b.bufnr == doc.bufnr)
  await (buf as any).sequence.ready
  return doc
}

describe('diagnostic manager', () => {
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

  it('should create diagnostic collection', async () => {
    let doc = await helper.createDocument()
    let collection = manager.create('test')
    collection.set(doc.uri, [createDiagnostic('foo')])
    await helper.wait(100)
    let info = await doc.buffer.getVar('coc_diagnostic_info')
    expect(info).toBeDefined()
  })

  it('should get sorted ranges of document', async () => {
    let doc = await helper.createDocument()
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

  it('should get diagnostics under corsor', async () => {
    await createDocument()
    let diagnostics = await manager.getCurrentDiagnostics()
    expect(diagnostics.length).toBe(0)
    await nvim.call('cursor', [1, 4])
    diagnostics = await manager.getCurrentDiagnostics()
    expect(diagnostics.length).toBe(1)
  })

  it('should jump to related position', async () => {
    let doc = await helper.createDocument()
    let range = Range.create(0, 0, 0, 10)
    let location = Location.create(URI.file(__filename).toString(), range)
    let diagnostic = Diagnostic.create(range, 'msg', DiagnosticSeverity.Error, 1000, 'test',
      [{ location, message: 'test' }])
    let collection = manager.create('positions')
    collection.set(doc.uri, [diagnostic])
    await helper.wait(300)
    await manager.jumpRelated()
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toMatch('diagnosticManager')
  })

  it('should jump to previous', async () => {
    let doc = await createDocument()
    await nvim.command('normal! G')
    let ranges = manager.getSortedRanges(doc.uri)
    ranges.reverse()
    for (let i = 0; i < ranges.length; i++) { // tslint:disable-line
      await manager.jumpPrevious()
      let pos = await workspace.getCursorPosition()
      expect(pos).toEqual(ranges[i].start)
    }
  })

  it('should jump to next', async () => {
    let doc = await createDocument()
    await nvim.call('cursor', [0, 0])
    let ranges = manager.getSortedRanges(doc.uri)
    for (let i = 0; i < ranges.length; i++) { // tslint:disable-line
      await manager.jumpNext()
      let pos = await workspace.getCursorPosition()
      expect(pos).toEqual(ranges[i].start)
    }
  })

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

  it('should filter diagnostics by level', async () => {
    helper.updateConfiguration('diagnostic.level', 'warning')
    let doc = await createDocument()
    let diagnostics = manager.getDiagnostics(doc.uri)
    for (let diagnostic of diagnostics) {
      expect(diagnostic.severity != DiagnosticSeverity.Hint).toBe(true)
      expect(diagnostic.severity != DiagnosticSeverity.Information).toBe(true)
    }
  })
})
