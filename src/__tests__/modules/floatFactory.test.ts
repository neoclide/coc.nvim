import workspace from '../../workspace'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import events from '../../events'
import FloatFactoryImpl from '../../model/floatFactory'
import snippetManager from '../../snippets/manager'
import { Documentation } from '../../types'

let nvim: Neovim
let floatFactory: FloatFactoryImpl
before(async () => {
  nvim = workspace.nvim
  floatFactory = new FloatFactoryImpl(nvim)
})

afterEach(editorReset)

describe('FloatFactory', () => {
  describe('show()', () => {
    it('should close after create window', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'
      }]
      let p = floatFactory.show(docs, { shadow: true, focusable: true, rounded: true, border: [1, 1, 1, 1] })
      floatFactory.close()
      await shared.wait(20)
      let win = floatFactory.window
      assert.strictEqual(win, null)
    })

    it('should show window', async t => {
      assert.strictEqual(floatFactory.window, null)
      assert.strictEqual(floatFactory.buffer, null)
      assert.strictEqual(floatFactory.bufnr, 0)
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'.repeat(81)
      }]
      await floatFactory.show(docs, { rounded: true })
      assert.notStrictEqual(floatFactory.window, undefined)
      assert.notStrictEqual(floatFactory.buffer, undefined)
      let buffer = floatFactory.buffer!
      assert.strictEqual(await buffer.name, `coc-float://${buffer.id}`)
      let hasFloat = await nvim.call('coc#float#has_float')
      assert.strictEqual(hasFloat, 1)
      await floatFactory.show([{ filetype: 'txt', content: '' }])
      assert.strictEqual(floatFactory.window, null)
    })

    it('should close when MenuPopupChanged', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'.repeat(81)
      }]
      await floatFactory.show(docs, { focusable: true })
      await events.fire('BufEnter', [floatFactory.bufnr])
      let ev = {
        row: 21,
        startcol: 0,
        index: 0,
        word: '',
        height: 1,
        width: 1,
        col: 10,
        size: 1,
        scrollbar: true,
        inserted: true,
        move: false,
      }
      await events.fire('MenuPopupChanged', [ev, 22])
      await events.fire('MenuPopupChanged', [ev, 20])
      assert.strictEqual(floatFactory.window, null)
      floatFactory.close()
    })

    it('should create fixed float window', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs, { position: 'fixed', focusable: true, bottom: 1, right: 1 })
      let res = await nvim.call('screenpos', [floatFactory.window.id, 1, 1]) as any
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.col > 150, true)
      assert.strictEqual(res.row > 70, true)
      floatFactory.close()
    })

    it('should create window', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'.repeat(81)
      }]
      await floatFactory.create(docs)
      assert.notStrictEqual(floatFactory.window, undefined)
    })

    it('should catch error on create', async t => {
      let fn = floatFactory.unbind
      floatFactory.unbind = () => {
        throw new Error('bad')
      }
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'.repeat(81)
      }]
      await floatFactory.show(docs)
      floatFactory.unbind = fn
      let msg = await shared.getCmdline()
      assert.match(msg, new RegExp('bad'))
    })

    it('should show only one window', async t => {
      await shared.edit()
      await nvim.setLine('foo')
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await Promise.all([
        floatFactory.show(docs),
        floatFactory.show(docs)
      ])
      let count = 0
      let wins = await nvim.windows
      for (let win of wins) {
        let isFloat = await win.getVar('float')
        if (isFloat) count++
      }
      assert.strictEqual(count, 1)
    })

    it('should close window when close called after create', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'
      }]
      let p = floatFactory.show(docs)
      await shared.wait(20)
      floatFactory.close()
      await p
      let activated = await floatFactory.activated()
      assert.strictEqual(activated, false)
    })

    it('should not create on visual mode', async t => {
      await shared.createDocument()
      await nvim.call('cursor', [1, 1])
      await nvim.setLine('foo')
      await nvim.command('normal! v$')
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'
      }]
      await floatFactory.show(docs)
      assert.strictEqual(floatFactory.window, null)
    })

    it('should allow select mode', async t => {
      await shared.createDocument()
      await snippetManager.insertSnippet('${1:foo}')
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs)
      let { mode } = await nvim.mode
      assert.strictEqual(mode, 's')
      await nvim.input('<esc>')
    })
  })

  describe('checkRetrigger', () => {
    it('should check retrigger', async t => {
      assert.strictEqual(floatFactory.checkRetrigger(99), false)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'
      }]
      await floatFactory.show(docs)
      assert.strictEqual(floatFactory.checkRetrigger(99), false)
      assert.strictEqual(floatFactory.checkRetrigger(bufnr), true)
    })
  })

  describe('options', () => {
    it('should config maxHeight and maxWidth', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'f'.repeat(80) + '\nbar',
      }]
      await floatFactory.show(docs, {
        maxWidth: 20,
        maxHeight: 1
      })
      let win = floatFactory.window
      assert.notStrictEqual(win, undefined)
      let width = await win.width
      let height = await win.height
      assert.strictEqual(width, 19)
      assert.strictEqual(height, 1)
    })

    it('should set border, title, highlight, borderhighlight, cursorline', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo\nbar'
      }]
      await floatFactory.show(docs, {
        border: [1, 1, 1, 1],
        title: 'title',
        highlight: 'Pmenu',
        borderhighlight: 'MoreMsg',
        cursorline: true
      })
      let activated = await floatFactory.activated()
      assert.strictEqual(activated, true)
    })

    it('should respect prefer top', async t => {
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo\nbar'
      }]
      await nvim.call('append', [1, ['', '', '']])
      await nvim.command('exe 4')
      await floatFactory.show(docs, { preferTop: true })
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let pos = await nvim.call('nvim_win_get_position', [win.id])
      assert.deepStrictEqual(pos, [1, 0])
    })
  })

  describe('events', () => {
    it('should hide on BufEnter', async t => {
      await shared.edit()
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs)
      await nvim.command(`edit foo`)
      await shared.waitFor('coc#float#has_float', [], 0)
    })

    it('should not hide when not moved', async t => {
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs, { focusable: false })
      floatFactory._onCursorMoved(false, bufnr, [1, 1])
    })

    it('should hide on CursorMoved', async t => {
      let doc = await shared.createDocument()
      await nvim.input('i')
      await nvim.setLine('foo')
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs)
      await shared.waitFloat()
      floatFactory._onCursorMoved(true, doc.bufnr, [3, 3])
      await shared.waitFor('coc#float#has_float', [], 0)
    })

    it('should not hide when cursor position not changed', async t => {
      await shared.edit()
      await nvim.setLine('foo')
      let cursor = await nvim.eval("[line('.'), col('.')]")
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs)
      floatFactory._onCursorMoved(false, floatFactory.bufnr, [1, 1])
      await nvim.call('cursor', cursor)
      await shared.wait(20)
      await nvim.call('cursor', cursor)
      await shared.wait(20)
      await shared.waitFor('coc#float#has_float', [], 1)
    })

    it('should preserve float when autohide disable and not overlap with pum', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.setLines(['foo', '', '', '', 'f'], { start: 0, end: -1, strictIndexing: false })
      await doc.synchronize()
      await nvim.call('cursor', [5, 1])
      await nvim.input('A')
      await shared.waitFor('mode', [], 'i')
      nvim.call('coc#start', [], true)
      await shared.waitPopup()
      let docs: Documentation[] = [{
        filetype: 'markdown',
        content: 'foo'
      }]
      await floatFactory.show(docs, {
        preferTop: true,
        autoHide: false
      })
      let activated = await floatFactory.activated()
      assert.strictEqual(activated, true)
    })
  })
})
