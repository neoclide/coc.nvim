import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../../commands'
import Cursors from '../../cursors'
import CursorsSession, { surroundChanges } from '../../cursors/session'
import TextRange from '../../cursors/textRange'
import { getChange, getDelta, getVisualRanges, isSurroundChange, isTextChange, splitRange, SurroundChange, TextChange } from '../../cursors/util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let cursors: Cursors
let ns: number

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  ns = await nvim.createNamespace('coc-cursors')
  cursors = window.cursors
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  nvim.pauseNotification()
  cursors.reset()
  await nvim.resumeNotification()
  await helper.reset()
})

async function rangeCount(): Promise<number> {
  let buf = await nvim.buffer
  let markers = await buf.getExtMarks(ns, 0, -1)
  return markers.length
}

describe('cursors utils', () => {
  describe('getDelta()', () => {
    it('should get delta count', async () => {
      assert.strictEqual(getDelta({ prepend: [1, 'foo'], append: [1, 'bar'], remove: false }), 4)
      assert.strictEqual(getDelta({ offset: 0, remove: 2, insert: 'foo' }), 1)
    })
  })

  describe('surroundChanges()', () => {
    it('should check surround changes', async () => {
      assert.strictEqual(surroundChanges([], 0), false)
      assert.strictEqual(surroundChanges([{ offset: 1, add: 'f' }, { offset: 3, add: 'f' }], 0), false)
    })

    it('should get surround change', async () => {
      const getText = (newText: string): string => {
        let r = new TextRange(0, 0, 'foo')
        let res = getChange(r, Range.create(0, 0, 0, 3), newText) as SurroundChange
        assert.strictEqual(isSurroundChange(res), true)
        r.applySurroundChange(res)
        return r.text
      }
      assert.strictEqual(getText('"foo"'), '"foo"')
      assert.strictEqual(getText('o'), 'o')
      assert.strictEqual(getText(''), '')
    })
  })

  describe('getChange()', () => {
    it('should get end change', async () => {
      const getText = (character: number, newText: string) => {
        let start = Position.create(0, character)
        let r = new TextRange(0, 0, 'foo')
        let res = getChange(r, Range.create(start, r.range.end), newText) as TextChange
        assert.strictEqual(isTextChange(res), true)
        r.applyTextChange(res)
        return r.text
      }
      assert.strictEqual(getText(3, 'bar'), 'foobar')
      assert.strictEqual(getText(1, ''), 'f')
      assert.strictEqual(getText(2, 'ba'), 'foba')
    })

    it('should get normal change', async () => {
      const getText = (start: number, end: number, newText: string) => {
        let r = new TextRange(0, 0, 'foo')
        let res = getChange(r, Range.create(0, start, 0, end), newText) as TextChange
        assert.strictEqual(isTextChange(res), true)
        r.applyTextChange(res)
        return r.text
      }
      assert.strictEqual(getText(0, 0, 'a'), 'afoo')
      assert.strictEqual(getText(0, 1, ''), 'oo')
      assert.strictEqual(getText(0, 2, 'ba'), 'bao')
    })

    it('should split ranges', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\n\nend')])
      let ranges = splitRange(doc, Range.create(0, 3, 3, 0))
      assert.deepStrictEqual(ranges, [Range.create(1, 0, 1, 3)])
    })

    it('should get visual ranges', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\nend')])
      let ranges = getVisualRanges(doc, Range.create(0, 3, 3, 0))
      assert.strictEqual(ranges.length, 4)
    })
  })
})

describe('cursors', () => {
  describe('cancel()', () => {
    it('should cancel cursors session', async () => {
      cursors.cancel(999)
      let doc = await workspace.document
      cursors.cancel(doc.bufnr)
      await nvim.call('setline', [1, ['a', 'b']])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'position', 'n')
      let activated = await cursors.isActivated()
      assert.strictEqual(activated, true)
      cursors.cancel(doc.bufnr)
      activated = await cursors.isActivated()
      assert.strictEqual(activated, false)
    })

    it('should cancel when no have ranges', async () => {
      let doc = await workspace.document
      let session = cursors.createSession(doc)
      session.checkRanges()
      let activated = await cursors.isActivated()
      assert.strictEqual(activated, false)
      session.cancel()
      session.dispose()
    })
  })

  describe('select()', () => {
    it('should throw with unsupported kind', async () => {
      let doc = await workspace.document
      let fn = async () => {
        await cursors.select(doc.bufnr, 'undefined', 'n')
      }
      await assert.rejects(fn(), /not supported/)
    })

    it('should select by position', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['a', 'b']])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'position', 'n')
      let n = await rangeCount()
      assert.strictEqual(n, 1)
      await nvim.setOption('virtualedit', 'onemore')
      await nvim.call('cursor', [2, 2])
      await cursors.select(doc.bufnr, 'position', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 2)
      await cursors.select(doc.bufnr, 'position', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 1)
    })

    it('should select by word', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', 'bar']])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'word', 'n')
      let n = await rangeCount()
      assert.strictEqual(n, 1)
      await nvim.call('cursor', [2, 2])
      await cursors.select(doc.bufnr, 'word', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 2)
      await cursors.select(doc.bufnr, 'word', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 1)
    })

    it('should toggle select', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', 'bar']])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'word', 'n')
      let n = await rangeCount()
      assert.strictEqual(n, 1)
      await cursors.select(doc.bufnr, 'word', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 0)
      let activated = await doc.buffer.getVar('coc_cursors_activated')
      assert.strictEqual(activated, 0)
    })

    it('should select last character', async () => {
      let doc = await workspace.document
      await nvim.setOption('virtualedit', 'onemore')
      await nvim.call('setline', [1, ['}', '{']])
      await nvim.call('cursor', [1, 2])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'word', 'n')
      let n = await rangeCount()
      assert.strictEqual(n, 1)
      await nvim.call('cursor', [2, 1])
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'word', 'n')
      n = await rangeCount()
      assert.strictEqual(n, 2)
    })

    it('should select by visual range', async () => {
      let doc = await workspace.document
      await cursors.select(doc.bufnr, 'range', 'v')
      let activated = await cursors.isActivated()
      assert.strictEqual(activated, false)
      await nvim.call('setline', [1, ['"foo"', '"bar"']])
      await nvim.call('cursor', [1, 1])
      await nvim.command('normal! vE')
      await doc.synchronize()
      await cursors.select(doc.bufnr, 'range', 'v')
      let n = await rangeCount()
      assert.strictEqual(n, 1)
      await nvim.call('cursor', [2, 1])
      await nvim.command('normal! vE')
      await cursors.select(doc.bufnr, 'range', 'v')
      n = await rangeCount()
      assert.strictEqual(n, 2)
      await cursors.select(doc.bufnr, 'range', 'v')
      n = await rangeCount()
      assert.strictEqual(n, 1)
    })

    it('should select visual blocks', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['let x = "foo"', 'let y = "bar"']])
      await doc.synchronize()
      await nvim.call('cursor', [1, 1])
      await nvim.input('<C-v>')
      await nvim.input('je')
      await helper.waitFor('mode', [], new RegExp(`[${String.fromCharCode(0x16)}v]`, 'i'))
      await cursors.select(doc.bufnr, 'range', '\x16')
      let n = await rangeCount()
      assert.strictEqual(n, 2)
    })

    it('should select by operator char type', async () => {
      await nvim.command('nmap x  <Plug>(coc-cursors-operator)')
      let bufnr = await nvim.call('bufnr', ['%']) as number
      await nvim.call('setline', [1, ['"short"', '"long"']])
      await nvim.call('cursor', [1, 2])
      await nvim.input('xi"')
      await helper.waitValue(() => {
        let s = cursors.getSession(bufnr)
        return s ? s.currentRanges.length : 0
      }, 1)
    })

    it('should select by operator line type', async () => {
      await nvim.command('nmap x  <Plug>(coc-cursors-operator)')
      let bufnr = await nvim.call('bufnr', ['%']) as number
      await nvim.call('setline', [1, ['"short"', '"long"']])
      await nvim.call('cursor', [1, 2])
      await nvim.input('xap')
      await helper.waitValue(() => {
        let s = cursors.getSession(bufnr)
        return s ? s.currentRanges.length : 0
      }, 2)
    })
  })

  describe('addRanges()', () => {
    it('should add ranges', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo foo foo', 'bar bar']])
      await doc.synchronize()
      let ranges = [
        Range.create(0, 0, 0, 3),
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
        Range.create(1, 0, 1, 3),
        Range.create(1, 4, 1, 7)
      ]
      await commands.executeCommand('editor.action.addRanges', ranges)
      let n = await rangeCount()
      assert.strictEqual(n, 5)
    })
  })

  describe('cancelRanges command', () => {
    it('should cancel cursors session of current buffer (#5052)', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo foo foo', 'bar bar']])
      await doc.synchronize()
      let ranges = [
        Range.create(0, 0, 0, 3),
        Range.create(0, 4, 0, 7),
      ]
      await commands.executeCommand('editor.action.addRanges', ranges)
      assert.notStrictEqual(cursors.getSession(doc.bufnr), undefined)
      await commands.executeCommand('editor.action.cancelRanges')
      assert.strictEqual(cursors.getSession(doc.bufnr), undefined)
      assert.strictEqual(await cursors.isActivated(), false)
    })
  })

  describe('validChange()', () => {
    it('should check valid change', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', 'foo', '']])
      await doc.synchronize()
      let ranges = [
        Range.create(0, 0, 0, 3),
        Range.create(1, 0, 1, 3),
      ]
      await helper.doAction('addRanges', ranges)
      let session = cursors.getSession(doc.bufnr)
      assert.strictEqual(session.validChange(Range.create(0, 0, 1, 0), ''), false)
      assert.strictEqual(session.validChange(Range.create(0, 0, 2, 0), '\n\n'), false)
      assert.strictEqual(session.validChange(Range.create(1, 0, 1, 3), 'bar'), false)
    })
  })

  describe('onChange()', () => {
    let session: CursorsSession

    function edit(sl: number, sc: number, el: number, ec: number, text: string): TextEdit {
      let r = Range.create(sl, sc, el, ec)
      return TextEdit.replace(r, text)
    }

    async function assertEdits(edits: TextEdit[], characters: number[], line?: string) {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo foo foo', '']])
      await doc.synchronize()
      let ranges = [
        Range.create(0, 0, 0, 3),
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
      ]
      await cursors.addRanges(ranges)
      session = cursors.getSession(doc.bufnr)
      let p = new Promise(resolve => {
        let disposable = session.onDidUpdate(() => {
          disposable.dispose()
          resolve(undefined)
        })
        void doc.applyEdits(edits)
      })
      await p
      if (line != null) {
        assert.strictEqual(doc.getline(0), line)
      }
      let arr: number[] = []
      session.currentRanges.forEach(r => {
        arr.push(r.start.character, r.end.character)
      })
      assert.deepStrictEqual(arr, characters)
      session.cancel()
    }

    it('should adjust on text insert', async () => {
      await assertEdits([edit(0, 0, 0, 0, 'bar\n')], [0, 3, 4, 7, 8, 11])
      await assertEdits([edit(0, 0, 0, 0, 'b')], [0, 4, 5, 9, 10, 14], 'bfoo bfoo bfoo')
      await assertEdits([edit(0, 1, 0, 1, 'b')], [0, 4, 5, 9, 10, 14], 'fboo fboo fboo')
      await assertEdits([edit(0, 3, 0, 3, 'b')], [0, 4, 5, 9, 10, 14], 'foob foob foob')
      await assertEdits([edit(0, 3, 0, 4, '\n')], [0, 3, 0, 3, 4, 7], 'foo')
      await assertEdits([edit(1, 0, 1, 0, 'bar')], [0, 3, 4, 7, 8, 11])
      await nvim.call('setline', [1, ['foo foo foo', '']])
      await nvim.call('cursor', [1, 4])
      await assertEdits([edit(0, 8, 0, 8, 'b')], [0, 4, 5, 9, 10, 14], 'bfoo bfoo bfoo')
      let col = await nvim.call('col', ['.'])
      assert.strictEqual(col, 5)
    })

    it('should adjust on text delete', async () => {
      await assertEdits([edit(0, 2, 0, 3, '')], [0, 2, 3, 5, 6, 8], 'fo fo fo')
      await assertEdits([edit(0, 3, 0, 4, '')], [0, 3, 3, 6, 7, 10], 'foofoo foo')
      await assertEdits([edit(0, 4, 0, 7, '')], [0, 0, 1, 1, 2, 2], '  ')
      await nvim.setLine('foo foo')
      await nvim.call('cursor', [1, 4])
      await assertEdits([edit(0, 3, 0, 7, '')], [0, 3, 4, 7], 'foo foo')
      await assertEdits([edit(0, 1, 0, 11, '')], [], 'f')
    })

    it('should adjust on text change', async () => {
      await assertEdits([edit(0, 0, 0, 0, '"'), edit(0, 3, 0, 3, '"')], [0, 5, 6, 11, 12, 17], '"foo" "foo" "foo"')
      await assertEdits([edit(0, 0, 0, 1, 'b')], [0, 3, 4, 7, 8, 11], 'boo boo boo')
      await assertEdits([edit(0, 0, 0, 3, 'ba')], [0, 2, 3, 5, 6, 8], 'ba ba ba')
      await nvim.call('setline', [1, ['', '']])
      await nvim.call('cursor', [2, 1])
      await assertEdits([edit(0, 4, 0, 5, 'ba')], [0, 4, 5, 9, 10, 14], 'baoo baoo baoo')
      let col = await nvim.call('col', ['.'])
      assert.strictEqual(col, 1)
    })

    it('should adjust on range remove', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', 'foobar']])
      await doc.synchronize()
      let ranges = [Range.create(0, 0, 0, 3), Range.create(1, 0, 1, 6)]
      await cursors.addRanges(ranges)
      session = cursors.getSession(doc.bufnr)
      await doc.applyEdits([TextEdit.del(Range.create(0, 0, 0, 3))])
      await doc.synchronize()
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['', ''])
      session.cancel()
    })

    it('should adjust on undo & redo', async () => {
      let doc = await workspace.document
      let edits = [edit(0, 0, 0, 0, '"'), edit(0, 3, 0, 3, '"')]
      await nvim.call('setline', [1, ['foo foo foo', '']])
      await doc.synchronize()
      let ranges = [
        Range.create(0, 0, 0, 3),
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
      ]
      await cursors.addRanges(ranges)
      session = cursors.getSession(doc.bufnr)
      let p = new Promise(resolve => {
        let disposable = session.onDidUpdate(() => {
          disposable.dispose()
          resolve(undefined)
        })
        void doc.applyEdits(edits)
      })
      await p
      let updated = new Promise<void>(resolve => {
        let disposable = session.onDidUpdate(() => {
          disposable.dispose()
          resolve()
        })
      })
      await nvim.command('undo')
      await updated
      assert.strictEqual(await nvim.getLine(), 'foo foo foo')
      assert.deepStrictEqual(session.currentRanges, ranges)
    })

    it('should highlight on empty content change', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', '']])
      await doc.synchronize()
      let ranges = [Range.create(0, 0, 0, 3)]
      await cursors.addRanges(ranges)
      session = cursors.getSession(doc.bufnr)
      await nvim.call('setline', [1, ['foo', '']])
      await doc.synchronize()
      let c = await rangeCount()
      assert.strictEqual(c, 1)
    })

    it('should cancel when insert line break', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['foo', '']])
      await doc.synchronize()
      let ranges = [Range.create(0, 0, 0, 3)]
      await cursors.addRanges(ranges)
      session = cursors.getSession(doc.bufnr)
      await nvim.call('cursor', [1, 2])
      await nvim.input('i<cr>')
      await doc.synchronize()
      let activated = await cursors.isActivated()
      assert.strictEqual(activated, false)
    })
  })

  describe('applyComposedEdit()', () => {
    async function setup(): Promise<CursorsSession> {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['bar foo foo', 'foo']])
      await doc.synchronize()
      let session = cursors.createSession(doc)
      session.addRanges([
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
        Range.create(1, 0, 1, 3),
      ])
      return session
    }

    it('should check change before first range', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['abc foob foob', 'foob'])
      assert.strictEqual(res, false)
    })

    it('should check change of first range', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar foo foob', 'foob'])
      assert.strictEqual(res, false)
    })

    it('should check delete exceed range', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar fofoo', 'foo'])
      assert.strictEqual(res, false)
    })

    it('should check content prepend', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar bfoo bfoo', 'bfoo'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 8),
        Range.create(0, 9, 0, 13),
        Range.create(1, 0, 1, 4),
      ])
      s = await setup()
      doc = await workspace.document
      res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar bfoo bfoo', 'xfoo'])
      assert.strictEqual(res, false)
    })

    it('should check content insert', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar fboo fboo', 'fboo'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 8),
        Range.create(0, 9, 0, 13),
        Range.create(1, 0, 1, 4),
      ])
    })

    it('should check content append', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar foob foob', 'foob'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 8),
        Range.create(0, 9, 0, 13),
        Range.create(1, 0, 1, 4),
      ])
    })

    it('should check content delete #1', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar oo oo', 'oo'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 6),
        Range.create(0, 7, 0, 9),
        Range.create(1, 0, 1, 2),
      ])
    })

    it('should check content delete #2', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar  ', ''])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 4),
        Range.create(0, 5, 0, 5),
        Range.create(1, 0, 1, 0),
      ])
    })

    it('should check content delete #3', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar fo fo', 'fo'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 6),
        Range.create(0, 7, 0, 9),
        Range.create(1, 0, 1, 2),
      ])
    })

    it('should check content change #1', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar fa fa', 'fa'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 6),
        Range.create(0, 7, 0, 9),
        Range.create(1, 0, 1, 2),
      ])
    })

    it('should check content change #1', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar fa fa', 'fa'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 6),
        Range.create(0, 7, 0, 9),
        Range.create(1, 0, 1, 2),
      ])
    })

    it('should check content change #2', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar ab ab', 'ab'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 6),
        Range.create(0, 7, 0, 9),
        Range.create(1, 0, 1, 2),
      ])
    })

    it('should check content change #3', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar xfa xfa', 'xfa'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
        Range.create(1, 0, 1, 3),
      ])
    })

    it('should check content change #4', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar xfao xfao', 'xfao'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 8),
        Range.create(0, 9, 0, 13),
        Range.create(1, 0, 1, 4),
      ])
    })

    it('should check surround add', async () => {
      let s = await setup()
      let doc = await workspace.document
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar "foo" "foo"', '"foo"'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 9),
        Range.create(0, 10, 0, 15),
        Range.create(1, 0, 1, 5),
      ])
    })

    it('should check surround remove', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['bar "foo" "foo"', '"foo"']])
      await doc.synchronize()
      let s = cursors.createSession(doc)
      s.addRanges([
        Range.create(0, 4, 0, 9),
        Range.create(0, 10, 0, 15),
        Range.create(1, 0, 1, 5),
      ])
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), ['bar foo foo', 'foo'])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 7),
        Range.create(0, 8, 0, 11),
        Range.create(1, 0, 1, 3),
      ])
    })

    it('should check surround change', async () => {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['bar "foo" "foo"', '"foo"']])
      await doc.synchronize()
      let s = cursors.createSession(doc)
      s.addRanges([
        Range.create(0, 4, 0, 9),
        Range.create(0, 10, 0, 15),
        Range.create(1, 0, 1, 5),
      ])
      let res = s.applyComposedEdit(doc.textDocument.lines.slice(), [`bar 'foo' 'foo'`, `'foo'`])
      assert.strictEqual(res, true)
      assert.deepStrictEqual(s.currentRanges, [
        Range.create(0, 4, 0, 9),
        Range.create(0, 10, 0, 15),
        Range.create(1, 0, 1, 5),
      ])
    })
  })

  describe('key mappings', () => {
    async function setup(): Promise<void> {
      let doc = await workspace.document
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await doc.synchronize()
      let session = cursors.createSession(doc)
      session.addRanges([
        Range.create(0, 0, 0, 1),
        Range.create(1, 0, 1, 1),
        Range.create(2, 0, 2, 1),
      ])
    }

    async function hasKeymap(key): Promise<boolean> {
      let buf = await nvim.buffer
      let keymaps = await buf.getKeymap('n') as any
      return keymaps.find(o => o.lhs == key) != null
    }

    it('should setup cancel keymap', async () => {
      await setup()
      let count = await rangeCount()
      assert.strictEqual(count, 3)
      await nvim.input('<esc>')
      await helper.waitValue(() => rangeCount(), 0)
      count = await rangeCount()
      assert.strictEqual(count, 0)
      let has = await hasKeymap('<Esc>')
      assert.strictEqual(has, false)
    })

    it('should next key wrapscan', async () => {
      await setup()
      await nvim.call('cursor', [1, 1])
      const next = async (line: number, character: number) => {
        await nvim.input('<C-n>')
        await helper.waitValue(async () => {
          return await nvim.call('coc#cursor#position')
        }, [line, character])
      }
      await next(1, 0)
      await next(2, 0)
      await next(0, 0)
    })

    it('should previous key wrapscan', async () => {
      await setup()
      await nvim.call('cursor', [3, 1])
      const prev = async (line: number, character: number) => {
        await nvim.input('<C-p>')
        await helper.waitValue(async () => {
          return await nvim.call('coc#cursor#position')
        }, [line, character])
      }
      await prev(1, 0)
      await prev(0, 0)
      await prev(2, 0)
    })

    it('should next key no wrapscan', async () => {
      helper.updateConfiguration('cursors.wrapscan', false)
      await setup()
      await nvim.call('cursor', [3, 1])
      const next = async (line: number, character: number) => {
        await nvim.input('<C-n>')
        await helper.waitValue(() => nvim.call('coc#cursor#position'), [line, character])
        let cursor = await nvim.call('coc#cursor#position')
        assert.deepStrictEqual(cursor, [line, character])
      }
      await next(2, 0)
    })

    it('should previous key no wrapscan', async () => {
      helper.updateConfiguration('cursors.wrapscan', false)
      await setup()
      await nvim.call('cursor', [1, 1])
      const prev = async (line: number, character: number) => {
        await nvim.input('<C-p>')
        await helper.waitValue(() => nvim.call('coc#cursor#position'), [line, character])
        let cursor = await nvim.call('coc#cursor#position')
        assert.deepStrictEqual(cursor, [line, character])
      }
      await prev(0, 0)
    })
  })
})
