import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { DiagnosticBuffer } from '../../diagnostic/buffer'
import { Range, DiagnosticSeverity, Diagnostic, DiagnosticTag } from 'vscode-languageserver-types'
import workspace from '../../workspace'

let nvim: Neovim
const config: any = {
  autoRefresh: true,
  checkCurrentLine: false,
  locationlistUpdate: true,
  enableSign: true,
  enableHighlightLineNumber: true,
  maxWindowHeight: 8,
  maxWindowWidth: 80,
  enableMessage: 'always',
  messageTarget: 'echo',
  messageDelay: 250,
  refreshOnInsertMode: false,
  virtualTextSrcId: 0,
  virtualText: false,
  virtualTextCurrentLineOnly: true,
  virtualTextPrefix: " ",
  virtualTextLines: 3,
  virtualTextLineSeparator: " \\ ",
  displayByAle: false,
  level: DiagnosticSeverity.Hint,
  signPriority: 11,
  errorSign: '>>',
  warningSign: '>>',
  infoSign: '>>',
  hintSign: '>>',
  filetypeMap: {
    default: ''
  },
}

async function createDiagnosticBuffer(): Promise<DiagnosticBuffer> {
  let doc = await helper.createDocument()
  return new DiagnosticBuffer(nvim, doc.bufnr, doc.uri, config, () => {
    // noop
  })
}

function createDiagnostic(msg: string, range?: Range, severity?: DiagnosticSeverity, tags?: DiagnosticTag[]): Diagnostic & { collection: string } {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Object.assign(Diagnostic.create(range, msg, severity || DiagnosticSeverity.Error, 999, 'test'), { collection: 'test', tags })
}

let ns: number
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  ns = await nvim.createNamespace('coc-diagnostic')
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('diagnostic buffer', () => {
  it('should add signs', async () => {
    let diagnostics = [createDiagnostic('foo'), createDiagnostic('bar')]
    let buf = await createDiagnosticBuffer()
    buf.addSigns(diagnostics)
    await helper.wait(30)
    let content = await nvim.call('execute', [`sign place group=* buffer=${buf.bufnr}`])
    let lines: string[] = content.split('\n')
    let line = lines.find(s => s.includes('CocError'))
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
    buf.setDiagnosticInfo(diagnostics)
    let buffer = await nvim.buffer
    let res = await buffer.getVar('coc_diagnostic_info')
    expect(res).toEqual({
      lnums: [1, 1, 1, 1],
      information: 1,
      hint: 1,
      warning: 1,
      error: 1
    })
  })

  it('should add highlight neovim', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
    let doc = workspace.getDocument(buf.bufnr)
    await nvim.setLine('abc')
    await doc.patchChange(true)
    nvim.pauseNotification()
    buf.updateHighlights([diagnostic])
    await nvim.resumeNotification()
    let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, {}]) as [number, number, number][]
    expect(res.length).toBe(1)
  })

  it('should add deprecated highlight', async () => {
    let diagnostic = createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Information, [DiagnosticTag.Deprecated])
    let buf = await createDiagnosticBuffer()
    let doc = workspace.getDocument(buf.bufnr)
    await nvim.setLine('foo')
    await doc.patchChange(true)
    nvim.pauseNotification()
    buf.updateHighlights([diagnostic])
    await nvim.resumeNotification()
    let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, {}]) as [number, number, number][]
    expect(res.length).toBe(1)
  })

  it('should clear all diagnostics', async () => {
    let diagnostic = createDiagnostic('foo')
    let buf = await createDiagnosticBuffer()
    let diagnostics = [diagnostic]
    buf.refresh(diagnostics)
    await helper.wait(100)
    buf.clear()
    let content = await nvim.call('execute', [`sign place buffer=${buf.bufnr}`])
    let lines: string[] = content.split('\n')
    let line = lines.find(s => s.includes('CocError'))
    expect(line).toBeUndefined()
    await helper.wait(50)
    let buffer = await nvim.buffer
    let res = await buffer.getVar("coc_diagnostic_info")
    expect(res == null).toBe(true)
  })
})
