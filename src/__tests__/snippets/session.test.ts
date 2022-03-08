import { Neovim } from '@chemzqm/neovim'
import { Position, Range } from 'vscode-languageserver-protocol'
import { SnippetSession } from '../../snippets/session'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
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

describe('SnippetSession', () => {
  describe('start()', () => {
    it('should not start on invalid range', async () => {
      let r = Range.create(3, 0, 3, 0)
      await nvim.input('i')
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('bar$0', false, r)
      expect(res).toBe(false)
    })

    it('should start with plain snippet', async () => {
      await nvim.input('i')
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('bar$0')
      expect(res).toBe(false)
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 3 })
    })

    it('should start with range replaced', async () => {
      await nvim.setLine('foo')
      await nvim.input('i')
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('bar$0', true, Range.create(0, 0, 0, 3))
      expect(res).toBe(false)
      let line = await nvim.line
      expect(line).toBe('bar')
    })

    it('should fix indent of next line when necessary', async () => {
      let buf = await nvim.buffer
      await nvim.setLine('  ab')
      await nvim.input('i<right><right><right>')
      let session = new SnippetSession(nvim, buf.id)
      let res = await session.start('${1:x}\n')
      expect(res).toBe(true)
      let lines = await buf.lines
      expect(lines).toEqual(['  ax', '  b'])
    })

    it('should insert indent for snippet endsWith line break', async () => {
      let buf = await nvim.buffer
      await nvim.setLine('  bar')
      await nvim.command('startinsert')
      await nvim.call('cursor', [1, 3])
      let session = new SnippetSession(nvim, buf.id)
      let res = await session.start('${1:foo}\n')
      expect(res).toBe(true)
      let lines = await buf.lines
      expect(lines).toEqual(['  foo', '  bar'])
    })

    it('should start without select placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start(' ${1:aa} ', false)
      expect(res).toBe(true)
      let { mode } = await nvim.mode
      expect(mode).toBe('n')
      await session.selectCurrentPlaceholder()
      await helper.waitFor('mode', [], 's')
    })

    it('should start with variable selected', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('${foo:bar}', false)
      expect(res).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('bar')
      await session.selectCurrentPlaceholder()
      await helper.waitFor('mode', [], 's')
    })

    it('should select none transform placeholder', async () => {
      await nvim.command('startinsert')
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${1/..*/ -> /}xy$1')
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should indent multiple lines variable text', async () => {
      let buf = await nvim.buffer
      let text = 'abc\n  def'
      await nvim.setVar('coc_selected_text', text)
      await nvim.input('i')
      let session = new SnippetSession(nvim, buf.id)
      await session.start('fun\n  ${0:${TM_SELECTED_TEXT:return}}\nend')
      let lines = await buf.lines
      expect(lines.length).toBe(4)
      expect(lines).toEqual([
        'fun', '  abc', '    def', 'end'
      ])
    })

    it('should resolve VISUAL', async () => {
      let text = 'abc'
      await nvim.setVar('coc_selected_text', text)
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('$VISUAL')
      let line = await nvim.line
      expect(line).toBe('abc')
    })

    it('should resolve default value of VISUAL', async () => {
      await nvim.setVar('coc_selected_text', '')
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${VISUAL:foo}')
      let line = await nvim.line
      expect(line).toBe('foo')
    })
  })

  describe('nested snippet', () => {
    it('should start with nest snippet', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('${1:a} ${2:b}', false)
      let line = await nvim.getLine()
      expect(line).toBe('a b')
      expect(res).toBe(true)
      let { placeholder } = session
      expect(placeholder.index).toBe(1)
      res = await session.start('${1:foo} ${2:bar}')
      expect(res).toBe(true)
      placeholder = session.placeholder
      expect(placeholder.index).toBe(2)
      line = await nvim.getLine()
      expect(line).toBe('foo bara b')
      expect(session.snippet.text).toBe('foo bara b')
      await session.nextPlaceholder()
      placeholder = session.placeholder
      expect(placeholder.index).toBe(3)
      expect(session.placeholder.value).toBe('bar')
      let col = await nvim.call('col', ['.'])
      expect(col).toBe(7)
      await session.nextPlaceholder()
      await session.nextPlaceholder()
      expect(session.placeholder.index).toBe(5)
      expect(session.placeholder.value).toBe('b')
    })

    it('should start nest snippet without select', async () => {
      let buf = await nvim.buffer
      await nvim.command('startinsert')
      let session = new SnippetSession(nvim, buf.id)
      let res = await session.start('${1:a} ${2:b}')
      let line = await nvim.call('getline', ['.'])
      res = await session.start('${1:foo} ${2:bar}', false)
      expect(res).toBe(true)
      line = await nvim.line
      expect(line).toBe('foo bara b')
    })

    it('should not create nest snippet for snippet with python placeholder reference', async () => {
      let buf = await nvim.buffer
      await nvim.input('i')
      let session = new SnippetSession(nvim, buf.id)
      await session.start('${1:a} ${2:b}')
      let res = await session.start('${1:foo} `!p snip.rv = t[1]`', false)
      expect(res).toBe(true)
      let p = session.placeholder
      expect(p.index).toBe(1)
    })
  })

  describe('sychronize()', () => {
    it('should cancel when change after snippet', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.setLine(' x')
      await nvim.input('i')
      await session.start('${1:foo }bar')
      await nvim.setLine('foo bar y')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should reset position when change before snippet', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.setLine('x')
      await nvim.input('a')
      await session.start('${1:foo} bar')
      await nvim.setLine('yfoo bar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      let start = session.snippet.start
      expect(start).toEqual(Position.create(0, 1))
    })

    it('should cancel when before and body changed', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.setLine('x')
      await nvim.input('a')
      await session.start('${1:foo }bar')
      await nvim.setLine('yfoo  bar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should cancel when unable to find placeholder', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.input('i')
      await session.start('${1:foo} bar')
      await nvim.setLine('foobar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should prefer range contains current cursor', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.input('i')
      await session.start('$1 $2')
      await nvim.input('<esc>A')
      await nvim.input(' ')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      let p = session.placeholder
      expect(p.index).toBe(2)
    })

    it('should update cursor column after sychronize', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.input('i')
      await session.start('${1} ${1:foo}')
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
      await nvim.input('a')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 5))
      await nvim.input('<backspace>')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
    })

    it('should update cursor line after sychronize', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      await nvim.input('i')
      await session.start('${1} ${1:foo}')
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
      await nvim.input('<cr>')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      pos = await window.getCursorPosition()
      let lines = await buf.lines
      expect(lines).toEqual(['b', ' b', ''])
      expect(pos).toEqual(Position.create(2, 0))
    })
  })

  describe('deactivate()', () => {

    it('should deactivate on cursor outside', async () => {
      let buf = await nvim.buffer
      let session = new SnippetSession(nvim, buf.id)
      let res = await session.start('a${1:a}b')
      expect(res).toBe(true)
      await buf.append(['foo', 'bar'])
      await nvim.call('cursor', [2, 1])
      await session.checkPosition()
      expect(session.isActive).toBe(false)
    })

    it('should not throw when jump on deactivate session', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      session.deactivate()
      await session.start('${1:foo} $0')
      await session.selectPlaceholder(undefined, true)
      await session.forceSynchronize()
      await session.previousPlaceholder()
      await session.nextPlaceholder()
    })

    it('should cancel keymap on jump final placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await nvim.input('i')
      await session.start('$0x${1:a}b$0')
      let line = await nvim.line
      expect(line).toBe('xab')
      let map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      expect(map).toMatch('snippetNext')
      await session.nextPlaceholder()
      map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      expect(map).toBe('')
    })
  })

  describe('nextPlaceholder()', () => {
    it('should jump to variable placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${foo} ${bar}', false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 6 })
    })

    it('should jump to variable placeholder after number placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${foo} ${1:bar}', false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 2 })
    })

    it('should jump to first placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${foo} ${foo} ${2:bar}', false)
      await session.selectCurrentPlaceholder()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 10 })
      await session.nextPlaceholder()
      pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 2 })
      await session.nextPlaceholder()
      pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 11 })
    })

    it('should goto next placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('${1:a} ${2:b} c')
      expect(res).toBe(true)
      await session.nextPlaceholder()
      let { placeholder } = session
      expect(placeholder.index).toBe(2)
    })

    it('should jump to none transform placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('${1} ${2/^_(.*)/$2/}bar$2')
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe(' bar')
      await session.nextPlaceholder()
      let col = await nvim.call('col', '.')
      expect(col).toBe(5)
    })
  })

  describe('previousPlaceholder()', () => {

    it('should goto previous placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      let res = await session.start('${1:foo} ${2:bar}')
      expect(res).toBe(true)
      await session.nextPlaceholder()
      expect(session.placeholder.index).toBe(2)
      await session.previousPlaceholder()
      expect(session.placeholder.index).toBe(1)
    })
  })

  describe('checkPosition()', () => {

    it('should cancel snippet if position out of range', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await nvim.setLine('bar')
      await session.start('${1:foo}')
      await nvim.call('cursor', [1, 5])
      await session.checkPosition()
      expect(session.isActive).toBe(false)
    })

    it('should not cancel snippet if position in range', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${1:foo}')
      await nvim.call('cursor', [1, 3])
      await session.checkPosition()
      expect(session.isActive).toBe(true)
    })
  })

  describe('findPlaceholder()', () => {

    it('should find current placeholder if possible', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${1:abc}${2:def}')
      let placeholder = session.findPlaceholder(Range.create(0, 3, 0, 3))
      expect(placeholder.index).toBe(1)
    })

    it('should return null if placeholder not found', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${1:abc}xyz${2:def}')
      let placeholder = session.findPlaceholder(Range.create(0, 4, 0, 4))
      expect(placeholder).toBeNull()
    })
  })

  describe('selectPlaceholder()', () => {

    it('should select range placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('${1:abc}')
      let mode = await nvim.mode
      expect(mode.mode).toBe('s')
      await nvim.input('<backspace>')
      let line = await nvim.line
      expect(line).toBe('')
    })

    it('should select empty placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await session.start('a ${1} ${2}')
      let mode = await nvim.mode
      expect(mode.mode).toBe('i')
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should select choice placeholder', async () => {
      let session = new SnippetSession(nvim, workspace.bufnr)
      await nvim.input('i')
      await session.start('${1|one,two,three|}')
      let line = await nvim.line
      expect(line).toBe('one')
      await helper.waitPopup()
      let val = await nvim.eval('g:coc#_context') as any
      expect(val.start).toBe(0)
      expect(val.candidates).toEqual(['one', 'two', 'three'])
    })
  })
})
