import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { DiagnosticBuffer } from '../../diagnostic/buffer'
import { Range, DiagnosticSeverity, Diagnostic, DiagnosticTag, Position, TextEdit } from 'vscode-languageserver-types'
import workspace from '../../workspace'

let nvim: Neovim
async function createDiagnosticBuffer(): Promise<DiagnosticBuffer> {
  let doc = await workspace.document
  return new DiagnosticBuffer(nvim, doc)
}

function createDiagnostic(msg: string, range?: Range, severity?: DiagnosticSeverity, tags?: DiagnosticTag[]): Diagnostic & { collection: string } {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Object.assign(Diagnostic.create(range, msg, severity || DiagnosticSeverity.Error, 999, 'test'), { collection: 'test', tags })
}

async function getExtmarkers(bufnr: number, ns: number): Promise<[number, number, number, number, string][]> {
  let res = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, 0, -1, { details: true }]) as any
  return res.map(o => {
    return [o[1], o[2], o[3].end_row, o[3].end_col, o[3].hl_group]
  })
}

let ns: number
let virtualTextSrcId: number
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  ns = await nvim.createNamespace('coc-diagnostic')
  virtualTextSrcId = await nvim.createNamespace('coc-diagnostic-virtualText')
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('diagnostic buffer', () => {
  describe('showFloat()', () => {
    it('should not show float when disabled', async () => {
      helper.updateConfiguration('diagnostic.messageTarget', 'echo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [createDiagnostic('foo')]
      let res = await buf.showFloat(diagnostics)
      expect(res).toBe(false)
    })

    it('should not show float in insert mode', async () => {
      let doc = await workspace.document
      let buf = new DiagnosticBuffer(nvim, doc)
      await nvim.input('i')
      let mode = await nvim.mode
      expect(mode.mode).toBe('i')
      let diagnostics = [createDiagnostic('foo')]
      let res = await buf.showFloat(diagnostics)
      expect(res).toBe(false)
    })
  })

  describe('refresh()', () => {
    it('should not add signs when disabled', async () => {
      helper.updateConfiguration('diagnostic.enableSign', false)
      let diagnostics = [createDiagnostic('foo'), createDiagnostic('bar')]
      let buf = await createDiagnosticBuffer()
      buf.addSigns('a', diagnostics)
      await helper.wait(30)
      let res = await nvim.call('sign_getplaced', [buf.bufnr, { group: 'CocDiagnostica' }])
      let signs = res[0].signs
      expect(signs).toEqual([])
    })

    it('should filter sign by signLevel', async () => {
      helper.updateConfiguration('diagnostic.signLevel', 'error')
      let range = Range.create(0, 0, 0, 3)
      let diagnostics = [createDiagnostic('foo', range, DiagnosticSeverity.Warning), createDiagnostic('bar', range, DiagnosticSeverity.Warning)]
      let buf = await createDiagnosticBuffer()
      buf.addSigns('a', diagnostics)
      await helper.wait(30)
      let res = await nvim.call('sign_getplaced', [buf.bufnr, { group: 'CocDiagnostica' }])
      let signs = res[0].signs
      expect(signs).toBeDefined()
      expect(signs.length).toBe(0)
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
      await buf.update('', diagnostics)
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

    it('should add highlight', async () => {
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('abc')
      await doc.patchChange(true)
      nvim.pauseNotification()
      buf.updateHighlights('', [
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error),
        createDiagnostic('bar', Range.create(0, 0, 0, 1), DiagnosticSeverity.Warning)
      ])
      await nvim.resumeNotification()
      let markers = await getExtmarkers(buf.bufnr, ns)
      expect(markers).toEqual([
        [0, 0, 0, 1, 'CocWarningHighlight'],
        [0, 0, 0, 1, 'CocErrorHighlight']
      ])
      nvim.pauseNotification()
      buf.updateHighlights('', [])
      await nvim.resumeNotification()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, { details: true }]) as any[]
      expect(res.length).toBe(0)
    })

    it('should add deprecated highlight', async () => {
      let diagnostic = createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Information, [DiagnosticTag.Deprecated])
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('foo')
      await doc.patchChange(true)
      nvim.pauseNotification()
      buf.updateHighlights('', [diagnostic])
      await nvim.resumeNotification()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, {}]) as [number, number, number][]
      expect(res.length).toBe(1)
    })

    it('should not refresh for empty diagnostics', async () => {
      let buf: any = await createDiagnosticBuffer()
      let fn = jest.fn()
      buf.refresh = () => {
        fn()
      }
      buf.update('c', [])
      expect(fn).toBeCalledTimes(0)
    })

    it('should refresh when content changes is empty', async () => {
      let diagnostic = createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error)
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('foo')
      doc._forceSync()
      nvim.pauseNotification()
      buf.updateHighlights('', [diagnostic])
      await nvim.resumeNotification()
      await nvim.setLine('foo')
      await doc.patchChange(true)
      doc._forceSync()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, { details: true }]) as any
      expect(res.length).toBe(1)
    })
  })

  describe('setDiagnosticInfo()', () => {
    it('should include lines', async () => {
      helper.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      let buf = await createDiagnosticBuffer()
      let r = Range.create(1, 1, 1, 3)
      let diagnostics = [
        createDiagnostic('foo', r, DiagnosticSeverity.Information),
        createDiagnostic('foo', r, DiagnosticSeverity.Information),
        createDiagnostic('foo', r, DiagnosticSeverity.Hint),
        createDiagnostic('foo', r, DiagnosticSeverity.Hint),
        createDiagnostic('foo', r, DiagnosticSeverity.Warning),
        createDiagnostic('foo', r, DiagnosticSeverity.Warning),
      ]
      await buf.update('', diagnostics)
      let buffer = await nvim.buffer
      let res = await buffer.getVar("coc_diagnostic_info") as any
      expect(res.lnums).toEqual([0, 2, 2, 2])
    })
  })

  describe('echoMessage', () => {
    it('should not echoMessage when disabled', async () => {
      helper.updateConfiguration('diagnostic.enableMessage', 'never')
      let buf = await createDiagnosticBuffer()
      let res = await buf.echoMessage(false, Position.create(0, 0))
      res = await buf.echoMessage(true, Position.create(0, 0))
      expect(res).toBe(false)
    })
  })

  describe('showVirtualText()', () => {
    beforeEach(() => {
      helper.updateConfiguration('diagnostic.virtualText', true)
    })

    it('should not show virtualText when disabled', async () => {
      helper.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      let buf = await createDiagnosticBuffer()
      await buf.setState(false)
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await buf.showVirtualTextCurrentLine(1)
      expect(res).toBe(false)
      helper.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', true)
      buf.loadConfiguration()
      await buf.setState(false)
      res = await buf.showVirtualTextCurrentLine(1)
      expect(res).toBe(false)
    })

    it('should show virtual text on current line', async () => {
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      expect(res.length).toBe(1)
      let texts = res[0][3].virt_text
      expect(texts[0]).toEqual([' foo', 'CocErrorVirtualText'])
    })

    it('should show virtual text at window column', async () => {
      helper.updateConfiguration('diagnostic.virtualTextWinCol', 90)
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      expect(res.length).toBe(1)
      let texts = res[0][3].virt_text
      expect(texts[0]).toEqual([' foo', 'CocErrorVirtualText'])
    })

    it('should virtual text on all lines', async () => {
      helper.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1)),
        createDiagnostic('bar', Range.create(1, 0, 1, 1)),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      expect(res.length).toBe(2)
    })

    it('should filter by virtualTextLevel', async () => {
      helper.updateConfiguration('diagnostic.virtualTextLevel', 'error')
      helper.updateConfiguration('diagnostic.virtualTextAlign', 'after')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error),
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Warning),
        createDiagnostic('bar', Range.create(1, 0, 1, 1), DiagnosticSeverity.Warning),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      expect(res.length).toBe(1)
    })

    it('should limit virtual text count of one line', async () => {
      helper.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      helper.updateConfiguration('diagnostic.virtualTextLimitInOneLine', 1)
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1)),
        createDiagnostic('bar', Range.create(0, 0, 0, 1)),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      expect(res[0][3].virt_text.length).toBe(1)
    })
  })

  describe('updateLocationList()', () => {
    beforeEach(() => {
      helper.updateConfiguration('diagnostic.locationlistUpdate', true)
    })

    it('should update location list', async () => {
      let buf = await createDiagnosticBuffer()
      await nvim.call('setloclist', [0, [], 'r', { title: 'Diagnostics of coc', items: [] }])
      await buf.update('a', [createDiagnostic('foo')])
      let res = await nvim.eval(`getloclist(bufwinid(${buf.bufnr}))`) as any[]
      expect(res.length).toBe(1)
      expect(res[0].text).toBe('[test 999] foo [E]')
    })
  })

  describe('clear()', () => {
    beforeEach(() => {
      helper.updateConfiguration('diagnostic.virtualText', true)
    })

    it('should clear all diagnostics', async () => {
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      buf.clear()
      let buffer = await nvim.buffer
      let res = await buffer.getVar("coc_diagnostic_info")
      expect(res == null).toBe(true)
    })
  })

  describe('reset()', () => {
    it('should clear exists diagnostics', async () => {
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('test', diagnostics)
      await helper.wait(30)
      await buf.reset({})
      let res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      expect(res?.error).toBe(0)
    })

    it('should not refresh when not enabled', async () => {
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('test', diagnostics)
      await buf.setState(false)
      await buf.setState(false)
      await buf.reset({ diagnostics: [createDiagnostic('bar')] })
      let res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      expect(res).toBeNull()
      await buf.setState(true)
      res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      expect(res?.error).toBe(1)
    })
  })

  describe('isEnabled()', () => {
    it('should return false when buffer disposed', async () => {
      let buf = await createDiagnosticBuffer()
      await nvim.command(`bd! ${buf.bufnr}`)
      buf.dispose()
      let res = await buf.isEnabled()
      expect(res).toBe(false)
      let arr = buf.getHighlightItems([])
      expect(arr.length).toBe(0)
    })
  })

  describe('getHighlightItems()', () => {
    it('should get highlights', async () => {
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(workspace.bufnr)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
      let diagnostics = [
        createDiagnostic('one', Range.create(0, 0, 0, 1), DiagnosticSeverity.Warning),
        createDiagnostic('one', Range.create(0, 1, 0, 2), DiagnosticSeverity.Warning),
        createDiagnostic('two', Range.create(0, 0, 2, 3), DiagnosticSeverity.Error),
        createDiagnostic('three', Range.create(1, 0, 1, 2), DiagnosticSeverity.Hint),
      ]
      diagnostics[0].tags = [DiagnosticTag.Unnecessary]
      diagnostics[1].tags = [DiagnosticTag.Deprecated]
      let res = buf.getHighlightItems(diagnostics)
      expect(res.length).toBe(5)
      expect(res.map(o => o.hlGroup)).toEqual([
        'CocUnusedHighlight',
        'CocErrorHighlight',
        'CocDeprecatedHighlight',
        'CocHintHighlight',
        'CocErrorHighlight'
      ])
    })
  })

  describe('getDiagnostics()', () => {
    it('should get sorted diagnostics', async () => {
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('three', Range.create(0, 1, 0, 2), DiagnosticSeverity.Error),
        createDiagnostic('one', Range.create(0, 0, 0, 2), DiagnosticSeverity.Warning),
        createDiagnostic('two', Range.create(0, 0, 0, 2), DiagnosticSeverity.Error),
      ]
      diagnostics[0].tags = [DiagnosticTag.Unnecessary]
      await buf.reset({
        x: diagnostics,
        y: [createDiagnostic('four', Range.create(0, 0, 0, 2), DiagnosticSeverity.Error)]
      })
      let res = buf.getDiagnosticsAt(Position.create(0, 1), false)
      let arr = res.map(o => o.message)
      expect(arr).toEqual(['four', 'two', 'three', 'one'])
    })
  })
})
