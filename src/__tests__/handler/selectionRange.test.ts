import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import SelectionRange from '../../handler/selectionRange'
import languages from '../../languages'
import workspace from '../../workspace'
import window from '../../window'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let selection: SelectionRange

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  selection = helper.plugin.getHandler().selectionRange
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
})

describe('selectionRange', () => {
  describe('getSelectionRanges()', () => {
    it('should throw error when selectionRange provider does not exist', async () => {
      let doc = await helper.createDocument()
      await doc.synchronize()
      await expect(async () => {
        await helper.doAction('selectionRanges')
      }).rejects.toThrow(Error)
    })

    it('should return ranges', async () => {
      await helper.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 0, 1)
          }]
        }
      }))
      let res = await selection.getSelectionRanges()
      expect(res).toBeDefined()
      expect(Array.isArray(res)).toBe(true)
    })
  })

  describe('selectRange()', () => {
    async function getSelectedRange(): Promise<Range> {
      let m = await nvim.mode
      expect(m.mode).toBe('v')
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      return res
    }

    it('should not select with empty ranges', async () => {
      let doc = await helper.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => []
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      expect(res).toBe(false)
    })

    it('should select single range', async () => {
      let doc = await helper.createDocument()
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => [{ range: Range.create(0, 0, 0, 3) }]
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      expect(res).toBe(true)
    })

    it('should select ranges forward', async () => {
      let doc = await helper.createDocument()
      let called = 0
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          called += 1
          let arr = [{
            range: Range.create(0, 0, 0, 1)
          }, {
            range: Range.create(0, 0, 0, 3)
          }, {
            range: Range.create(0, 0, 1, 3)
          }]
          return arr
        }
      }))
      await doc.synchronize()
      await helper.doAction('rangeSelect', '', false)
      await selection.selectRange('', true)
      expect(called).toBe(1)
      let res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 0, 1))
      await selection.selectRange('v', true)
      expect(called).toBe(2)
      res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 0, 3))
      await selection.selectRange('v', true)
      expect(called).toBe(3)
      res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 1, 3))
      await selection.selectRange('v', true)
      expect(called).toBe(4)
      let m = await nvim.mode
      expect(m.mode).toBe('n')
    })

    it('should select ranges backward', async () => {
      let doc = await helper.createDocument()
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      await nvim.call('cursor', [1, 1])
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          let arr = [{
            range: Range.create(0, 0, 0, 1)
          }, {
            range: Range.create(0, 0, 0, 3)
          }, {
            range: Range.create(0, 0, 1, 3)
          }]
          return arr
        }
      }))
      await doc.synchronize()
      await selection.selectRange('', true)
      let mode = await nvim.call('mode')
      expect(mode).toBe('v')
      await nvim.input('<esc>')
      await window.selectRange(Range.create(0, 0, 1, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      let r = await getSelectedRange()
      expect(r).toEqual(Range.create(0, 0, 0, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      r = await getSelectedRange()
      expect(r).toEqual(Range.create(0, 0, 0, 1))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      mode = await nvim.call('mode')
      expect(mode).toBe('n')
    })
  })

  describe('provideSelectionRanges()', () => {
    it('should return null when no provider available', async () => {
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should return null when no result available', async () => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return []
        }
      }))
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should append/prepend selection ranges', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 1, 1, 4) }, { range: Range.create(1, 0, 1, 6) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 2, 1, 3) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 2, 1, 3) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(0, 0, 3, 0) }]
        }
      }))

      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      expect(res.length).toBe(4)
      expect(res[0].range).toEqual(Range.create(1, 2, 1, 3))
      expect(res[3].range).toEqual(Range.create(0, 0, 3, 0))
    })
  })
})
