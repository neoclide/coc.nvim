import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { DiagnosticBuffer } from '../../diagnostic/buffer'
import { DiagnosticConfig } from '../../diagnostic/manager'
import { Range, DiagnosticSeverity, Diagnostic } from 'vscode-languageserver-types'
import { DiagnosticItems } from '../../types'

let nvim: Neovim
const config: DiagnosticConfig = {
  virtualText: false,
  displayByAle: false,
  srcId: 1000,
  level: DiagnosticSeverity.Hint,
  locationlist: true,
  signOffset: 1000,
  errorSign: '>>',
  warningSign: '>>',
  infoSign: '>>',
  hintSign: '>>'
}

async function createDiagnosticBuffer(): Promise<DiagnosticBuffer> {
  let doc = await helper.createDocument()
  return new DiagnosticBuffer(doc, config)
}

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

describe('diagnostic buffer', () => {

  it('should set locationlist', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
    await buf.setLocationlist([diagnostic])
    let winid = await nvim.call('bufwinid', buf.bufnr) as number
    let curr = await nvim.call('getloclist', [winid, { title: 1 }])
    expect(curr.title).toBe('Diagnostics of coc')
  })

  it('should check signs', async () => {
    let buf = await createDiagnosticBuffer()
    await nvim.setLine('foo')
    await nvim.command(`sign place 1005 line=1 name=CocError buffer=${buf.bufnr}`)
    await nvim.command(`sign place 1006 line=1 name=CocError buffer=${buf.bufnr}`)
    await buf.checkSigns()
    let content = await nvim.call('execute', [`sign place buffer=${buf.bufnr}`])
    let lines: string[] = content.split('\n')
    let line = lines.find(s => s.indexOf('CocError') != -1)
    expect(line).toBeUndefined()
  })

  it('should add signs', async () => {
    let diagnostics = [createDiagnostic('foo'), createDiagnostic('bar')]
    let buf = await createDiagnosticBuffer()
    buf.addSigns(diagnostics)
    await helper.wait(30)
    let content = await nvim.call('execute', [`sign place buffer=${buf.bufnr}`])
    let lines: string[] = content.split('\n')
    let line = lines.find(s => s.indexOf('CocError') != -1)
    expect(line).toBeDefined()
  })

  it('should set diagnostic info', async () => {
    let r = Range.create(0, 1, 0, 2)
    let diagnostics = [
      createDiagnostic('foo', r, DiagnosticSeverity.Error),
      createDiagnostic('bar', r, DiagnosticSeverity.Warning),
      createDiagnostic('foo', r, DiagnosticSeverity.Hint),
      createDiagnostic('bar', r, DiagnosticSeverity.Information)
    ]
    let buf = await createDiagnosticBuffer()
    await buf.setDiagnosticInfo(diagnostics)
    let buffer = await nvim.buffer
    let res = await buffer.getVar('coc_diagnostic_info')
    expect(res).toEqual({
      information: 1,
      hint: 1,
      warning: 1,
      error: 1
    })
  })

  it('should add highlight neovim', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
    await buf.addHighlight([diagnostic])
    expect(buf.hasMatch(1000)).toBe(true)
  })

  it('should add highlight vim', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
      ; (buf as any).isVim = true
    let buffer = await nvim.buffer
    await buffer.setLines(['foo', 'bar', 'foo', 'bar'], {
      start: 0,
      end: -1,
      strictIndexing: false
    })
    await buf.addHighlight([diagnostic, createDiagnostic('bar', Range.create(0, 0, 1, 2), DiagnosticSeverity.Warning)])
    let { matchIds } = buf as any
    expect(matchIds.size).toBe(2)
      ; (buf as any).isVim = false
  })

  it('should clear all diagnostics', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
    let diagnostics: DiagnosticItems = {
      test: [diagnostic]
    }
    buf.refresh(diagnostics)
    await helper.wait(100)
    await buf.clear()
    let content = await nvim.call('execute', [`sign place buffer=${buf.bufnr}`])
    let lines: string[] = content.split('\n')
    let line = lines.find(s => s.indexOf('CocError') != -1)
    expect(line).toBeUndefined()
    let winid = await nvim.call('bufwinid', buf.bufnr) as number
    let curr = await nvim.call('getloclist', [winid, { title: 1 }])
    expect(curr.title).toBeUndefined()
    let buffer = await nvim.buffer
    let res = await buffer.getVar('coc_diagnostic_info')
    expect(res).toEqual({
      information: 0,
      hint: 0,
      warning: 0,
      error: 0
    })
    let { matchIds } = buf as any
    expect(matchIds.size).toBe(0)
  })
})
