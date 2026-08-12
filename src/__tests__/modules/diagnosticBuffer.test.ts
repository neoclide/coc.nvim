import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Location, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { DiagnosticBuffer } from '../../diagnostic/buffer'
import { DidChangeTextDocumentParams } from '../../types'
import workspace from '../../workspace'
import { URI } from 'vscode-uri'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

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
before(async () => {
  nvim = workspace.nvim
  ns = await nvim.createNamespace('coc-diagnostic')
  virtualTextSrcId = await nvim.createNamespace('coc-diagnostic-virtualText')
})

afterEach(editorReset)

describe('diagnostic buffer', () => {
  describe('showFloat()', () => {
    it('should not show float when disabled', async t => {
      shared.updateConfiguration('diagnostic.messageTarget', 'echo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [createDiagnostic('foo')]
      let res = await buf.showFloat(diagnostics, 'echo')
      assert.strictEqual(res, false)
    })

    it('should not show float in insert mode', async t => {
      let doc = await workspace.document
      let buf = new DiagnosticBuffer(nvim, doc)
      await nvim.input('i')
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'i')
      let diagnostics = [createDiagnostic('foo')]
      let res = await buf.showFloat(diagnostics)
      assert.strictEqual(res, false)
    })

    it('should show related information in floating window', async t => {
      let buf = await createDiagnosticBuffer()
      let range = Range.create(0, 0, 0, 10)
      let location = Location.create(URI.file(import.meta.filename).toString(), range)
      let diagnostic = Diagnostic.create(range, 'msg', 1, 1000, 'test', [{ location, message: 'this is a related information' }])
      await buf.showFloat([diagnostic])
      await nvim.call('cursor', [1, 1])

      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let floatBuf = await win.buffer
      let lines = await floatBuf.lines
      assert.strictEqual(lines.length, 7)
      assert.strictEqual(lines[2], 'Related information:')
      assert.strictEqual(lines[4].includes('this is a related information'), true)
    })

    it('should show formated diagnostics', async t => {
      shared.updateConfiguration('diagnostic.format', '[%source] %message')
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      await buf.showFloat([diagnostic])
      await nvim.call('cursor', [1, 1])

      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let floatBuf = await win.buffer
      let lines = await floatBuf.lines
      assert.deepStrictEqual(lines[0], '[test] foo')
    })
  })

  describe('refresh()', () => {
    it('should not add signs when disabled', async t => {
      shared.updateConfiguration('diagnostic.enableSign', false)
      let diagnostics = [createDiagnostic('foo'), createDiagnostic('bar')]
      let buf = await createDiagnosticBuffer()
      buf.addSigns('a', diagnostics)
      await shared.wait(30)
      let res = await nvim.call('sign_getplaced', [buf.bufnr, { group: 'CocDiagnostica' }])
      let signs = res[0].signs
      assert.deepStrictEqual(signs, [])
    })

    it('should filter sign by signLevel', async t => {
      shared.updateConfiguration('diagnostic.signLevel', 'error')
      let range = Range.create(0, 0, 0, 3)
      let diagnostics = [createDiagnostic('foo', range, DiagnosticSeverity.Warning), createDiagnostic('bar', range, DiagnosticSeverity.Warning)]
      let buf = await createDiagnosticBuffer()
      buf.addSigns('a', diagnostics)
      await shared.wait(30)
      let res = await nvim.call('sign_getplaced', [buf.bufnr, { group: 'CocDiagnostica' }])
      let signs = res[0].signs
      assert.notStrictEqual(signs, undefined)
      assert.strictEqual(signs.length, 0)
    })

    it('should set diagnostic info', async t => {
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
      assert.deepStrictEqual(res, {
        lnums: [1, 1, 1, 1],
        information: 1,
        hint: 1,
        warning: 1,
        error: 1
      })
    })

    it('should add highlight', async t => {
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('abc')
      await doc.patchChange()
      nvim.pauseNotification()
      buf.updateHighlights('', [
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error),
        createDiagnostic('bar', Range.create(0, 0, 0, 1), DiagnosticSeverity.Warning)
      ])
      await nvim.resumeNotification()
      let markers = await getExtmarkers(buf.bufnr, ns)
      assert.deepStrictEqual(markers, [
        [0, 0, 0, 1, 'CocWarningHighlight'],
        [0, 0, 0, 1, 'CocErrorHighlight']
      ])
      nvim.pauseNotification()
      buf.updateHighlights('', [])
      await nvim.resumeNotification()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, { details: true }]) as any[]
      assert.strictEqual(res.length, 0)
    })

    it('should add deprecated highlight', async t => {
      let diagnostic = createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Information, [DiagnosticTag.Deprecated])
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('foo')
      await doc.patchChange()
      nvim.pauseNotification()
      buf.updateHighlights('', [diagnostic])
      await nvim.resumeNotification()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, {}]) as [number, number, number][]
      assert.strictEqual(res.length, 2)
    })

    it('should not refresh for empty diagnostics', async t => {
      let buf: any = await createDiagnosticBuffer()
      let fn = t.mock.fn()
      buf.refresh = () => {
        fn()
      }
      buf.update('c', [])
      assert.strictEqual(fn.mock.calls.length, 0)
    })

    it('should refresh when content changes is empty', async t => {
      let diagnostic = createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error)
      let buf = await createDiagnosticBuffer()
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.setLine('foo')
      doc._forceSync()
      nvim.pauseNotification()
      buf.updateHighlights('', [diagnostic])
      await nvim.resumeNotification()
      await nvim.setLine('foo')
      await doc.patchChange()
      doc._forceSync()
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, ns, 0, -1, { details: true }]) as any
      assert.strictEqual(res.length, 1)
    })
  })

  describe('onChange()', () => {
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

    it('should mark only affected collections dirty', async t => {
      shared.updateConfiguration('diagnostic.autoRefresh', false)
      let buf = await createDiagnosticBuffer()
      let diag = Diagnostic.create(Range.create(0, 3, 0, 5), 'after')
      buf['diagnosticsMap'].set('a', [diag])
      buf.onChange(createChange(buf, 1, Range.create(0, 8, 0, 8), 'x'))
      assert.strictEqual(buf['_dirties'].has('a'), false)
      buf.onChange(createChange(buf, 2, Range.create(0, 1, 0, 1), 'xy'))
      assert.strictEqual(buf['_dirties'].has('a'), true)
    })

    it('should keep unaffected collections unchanged', async t => {
      shared.updateConfiguration('diagnostic.autoRefresh', false)
      let buf = await createDiagnosticBuffer()
      let affected = Diagnostic.create(Range.create(0, 3, 0, 5), 'affected')
      let unaffected = Diagnostic.create(Range.create(0, 0, 0, 1), 'unaffected')
      buf['diagnosticsMap'].set('a', [affected])
      buf['diagnosticsMap'].set('b', [unaffected])
      let before = buf['diagnosticsMap'].get('b')
      buf.onChange(createChange(buf, 1, Range.create(0, 1, 0, 1), 'xy'))

      assert.strictEqual(buf['diagnosticsMap'].get('b'), before)
      assert.strictEqual(buf['_dirties'].has('b'), false)
      assert.strictEqual(buf['_dirties'].has('a'), true)
      let adjusted = buf['diagnosticsMap'].get('a')
      assert.notStrictEqual(adjusted, before)
      assert.deepStrictEqual(adjusted[0].range, Range.create(0, 5, 0, 7))
      assert.deepStrictEqual(affected.range, Range.create(0, 3, 0, 5))
    })

    it('should retain pre-existing dirty collections', async t => {
      shared.updateConfiguration('diagnostic.autoRefresh', false)
      let buf = await createDiagnosticBuffer()
      buf['diagnosticsMap'].set('a', [Diagnostic.create(Range.create(0, 3, 0, 5), 'a')])
      buf['diagnosticsMap'].set('b', [Diagnostic.create(Range.create(0, 3, 0, 5), 'b')])
      buf['_dirties'].add('b')
      buf.onChange(createChange(buf, 1, Range.create(0, 1, 0, 1), 'xy'))

      assert.strictEqual(buf['_dirties'].has('a'), true)
      assert.strictEqual(buf['_dirties'].has('b'), true)
    })
  })

  describe('setDiagnosticInfo()', () => {
    it('should include lines', async t => {
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
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
      assert.deepStrictEqual(res.lnums, [0, 2, 2, 2])
    })
  })

  describe('echoMessage', () => {
    it('should not echoMessage when disabled', async t => {
      shared.updateConfiguration('diagnostic.enableMessage', 'never')
      let buf = await createDiagnosticBuffer()
      let res = await buf.echoMessage(false, Position.create(0, 0))
      res = await buf.echoMessage(true, Position.create(0, 0))
      assert.strictEqual(res, false)
    })
  })

  describe('showVirtualText()', () => {
    beforeEach(() => {
      shared.updateConfiguration('diagnostic.virtualText', true)
    })

    it('should not show virtualText when disabled', async t => {
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      let buf = await createDiagnosticBuffer()
      await buf.setState(false)
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await buf.showVirtualTextCurrentLine(1)
      assert.strictEqual(res, false)
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', true)
      buf.loadConfiguration()
      await buf.setState(false)
      res = await buf.showVirtualTextCurrentLine(1)
      assert.strictEqual(res, false)
    })

    it('should change format of virtualText message', async t => {
      shared.updateConfiguration('diagnostic.virtualTextFormat', '%source %message')
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      await buf.update('', [diagnostic])
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      let texts = res[0][3].virt_text
      assert.strictEqual(texts[0][0], ' test foo')
    })

    it('should show virtual text on current line', async t => {
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      assert.strictEqual(res.length, 1)
      let texts = res[0][3].virt_text
      assert.deepStrictEqual(texts[0], [' foo', 'CocErrorVirtualText'])
    })

    it('should show virtual text at window column', async t => {
      shared.updateConfiguration('diagnostic.virtualTextWinCol', 90)
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      assert.strictEqual(res.length, 1)
      let texts = res[0][3].virt_text
      assert.deepStrictEqual(texts[0], [' foo', 'CocErrorVirtualText'])
    })

    it('should virtual text on all lines', async t => {
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1)),
        createDiagnostic('bar', Range.create(1, 0, 1, 1)),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      assert.strictEqual(res.length, 2)
    })

    it('should filter by virtualTextLevel', async t => {
      shared.updateConfiguration('diagnostic.virtualTextLevel', 'error')
      shared.updateConfiguration('diagnostic.virtualTextAlign', 'after')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Error),
        createDiagnostic('foo', Range.create(0, 0, 0, 1), DiagnosticSeverity.Warning),
        createDiagnostic('bar', Range.create(1, 0, 1, 1), DiagnosticSeverity.Warning),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      assert.strictEqual(res.length, 1)
    })

    it('should limit virtual text count of one line', async t => {
      shared.updateConfiguration('diagnostic.virtualTextCurrentLineOnly', false)
      shared.updateConfiguration('diagnostic.virtualTextLimitInOneLine', 1)
      let buf = await createDiagnosticBuffer()
      let diagnostics = [
        createDiagnostic('foo', Range.create(0, 0, 0, 1)),
        createDiagnostic('bar', Range.create(0, 0, 0, 1)),
      ]
      await buf.update('', diagnostics)
      let res = await nvim.call('nvim_buf_get_extmarks', [buf.bufnr, virtualTextSrcId, 0, -1, { details: true }]) as any
      assert.strictEqual(res[0][3].virt_text.length, 1)
    })
  })

  describe('updateLocationList()', () => {
    beforeEach(() => {
      shared.updateConfiguration('diagnostic.locationlistUpdate', true)
    })

    it('should update location list', async t => {
      let buf = await createDiagnosticBuffer()
      await nvim.call('setloclist', [0, [], 'r', { title: 'Diagnostics of coc', items: [] }])
      await buf.update('a', [createDiagnostic('foo')])
      let res = await nvim.eval(`getloclist(bufwinid(${buf.bufnr}))`) as any[]
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].text, '[test 999] foo [E]')
    })
  })

  describe('clear()', () => {
    beforeEach(() => {
      shared.updateConfiguration('diagnostic.virtualText', true)
    })

    it('should clear all diagnostics', async t => {
      let diagnostic = createDiagnostic('foo')
      let buf = await createDiagnosticBuffer()
      let diagnostics = [diagnostic]
      await buf.update('', diagnostics)
      buf.clear()
      let buffer = await nvim.buffer
      let res = await buffer.getVar("coc_diagnostic_info")
      assert.strictEqual(res == null, true)
    })
  })

  describe('reset()', () => {
    it('should clear exists diagnostics', async t => {
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('test', diagnostics)
      await shared.waitValue(async () => (await buf.doc.buffer.getVar('coc_diagnostic_info') as any)?.error, 1)
      await buf.reset({})
      let res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      assert.strictEqual(res?.error, 0)
    })

    it('should not refresh when not enabled', async t => {
      let buf = await createDiagnosticBuffer()
      let diagnostic = createDiagnostic('foo')
      let diagnostics = [diagnostic]
      await buf.update('test', diagnostics)
      await buf.setState(false)
      await buf.setState(false)
      await buf.reset({ diagnostics: [createDiagnostic('bar')] })
      let res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      assert.strictEqual(res, null)
      await buf.setState(true)
      res = await buf.doc.buffer.getVar("coc_diagnostic_info") as any
      assert.strictEqual(res?.error, 1)
    })
  })

  describe('isEnabled()', () => {
    it('should return false when buffer disposed', async t => {
      let buf = await createDiagnosticBuffer()
      await nvim.command(`bd! ${buf.bufnr}`)
      buf.dispose()
      let res = await buf.isEnabled()
      assert.strictEqual(res, false)
      let arr = buf.getHighlightItems([])
      assert.strictEqual(arr.length, 0)
    })
  })

  describe('getHighlightItems()', () => {
    it('should get highlights', async t => {
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
      assert.strictEqual(res.length, 7)
      assert.deepStrictEqual(res.map(o => o.hlGroup), [
        'CocUnusedHighlight',
        'CocWarningHighlight',
        'CocErrorHighlight',
        'CocDeprecatedHighlight',
        'CocWarningHighlight',
        'CocHintHighlight',
        'CocErrorHighlight'
      ])
    })
  })

  describe('getDiagnostics()', () => {
    it('should get sorted diagnostics', async t => {
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
      assert.deepStrictEqual(arr, ['four', 'two', 'three', 'one'])
    })
  })
})
