import { Range } from 'vscode-languageserver-protocol'
import { Neovim } from '@chemzqm/neovim'
import workspace from '../../workspace'
import window from '../../window'
import { SnippetSession } from '../../snippets/session'
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

describe('SnippetSession#start', () => {

  it('should start with plain snippet', async () => {
    let buf = await helper.edit()
    await helper.wait(30)
    await nvim.input('i')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('bar$0')
    expect(res).toBe(false)
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 3 })
  })

  it('should start with range replaced', async () => {
    let buf = await helper.edit()
    await helper.wait(30)
    await nvim.setLine('foo')
    await nvim.input('i')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('bar$0', true, Range.create(0, 0, 0, 3))
    expect(res).toBe(false)
    let line = await nvim.line
    expect(line).toBe('bar')
  })

  it('should insert placeholder with default value', async () => {
    let buf = await helper.edit()
    await helper.wait(30)
    await nvim.input('i')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('a${TM_SELECTED_TEXT:return}b')
    expect(res).toBe(false)
    let line = await nvim.line
    expect(line).toBe('areturnb')
  })

  it('should fix indent of next line when necessary', async () => {
    let buf = await helper.edit()
    await nvim.setLine('  ab')
    await nvim.input('i<right><right><right>')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('x\n')
    expect(res).toBe(false)
    let lines = await buf.lines
    expect(lines).toEqual(['  ax', '  b'])
  })

  it('should start with final position for plain snippet', async () => {
    let buf = await helper.edit()
    await nvim.command('startinsert')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('bar$0')
    expect(res).toBe(false)
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 3 })
  })

  it('should insert indent for snippet endsWith line break', async () => {
    let buf = await helper.edit()
    await nvim.setLine('  bar')
    await helper.wait(10)
    await nvim.command('startinsert')
    await nvim.call('cursor', [1, 3])
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('foo\n')
    expect(res).toBe(false)
    let lines = await buf.lines
    expect(lines).toEqual(['  foo', '  bar'])
  })

  it('should insert resolved variable', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${TM_LINE_NUMBER}')
    expect(res).toBe(false)
    let line = await nvim.line
    expect(line).toBe('1')
  })

  it('should use default value of unresolved variable', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${TM_SELECTION:abc}')
    expect(res).toBe(false)
    let line = await nvim.line
    expect(line).toBe('abc')
  })

  it('should start with snippet insert', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start(' ${1:aa} bb $1')
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe(' aa bb aa')
    let { mode } = await nvim.mode
    expect(mode).toBe('s')
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 2 })
  })

  it('should start without select placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start(' ${1:aa} ', false)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe(' aa ')
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await session.selectCurrentPlaceholder()
    await helper.wait(100)
    let m = await nvim.mode
    expect(m.mode).toBe('s')
  })

  it('should start with variable selected', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${foo:bar}', false)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('bar')
    await session.selectCurrentPlaceholder()
    await helper.wait(100)
    let m = await nvim.mode
    expect(m.mode).toBe('s')
  })

  it('should start with nest snippet', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:a} ${2:b}', false)
    let line = await nvim.getLine()
    expect(line).toBe('a b')
    expect(res).toBe(true)
    let { placeholder } = session
    expect(placeholder.index).toBe(1)
    res = await session.start('${1:foo} ${2:bar}')
    expect(res).toBe(true)
    placeholder = session.placeholder
    let { snippet } = session
    expect(placeholder.index).toBe(2)
    line = await nvim.getLine()
    expect(line).toBe('foo bara b')
    expect(snippet.toString()).toBe('foo bara b')
  })

  it('should jump to nested snippet placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1} ${2:b}', false)
    await session.start('${1:foo} ${2:bar}')
    await session.nextPlaceholder()
    await session.nextPlaceholder()
    await session.nextPlaceholder()
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 8 })
  })

  it('should jump to variable placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${foo} ${bar}', false)
    await session.selectCurrentPlaceholder()
    await helper.wait(100)
    await session.nextPlaceholder()
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 6 })
  })

  it('should jump to variable placeholder after number placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${foo} ${1:bar}', false)
    await session.selectCurrentPlaceholder()
    await session.nextPlaceholder()
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 2 })
  })

  it('should jump to variable placeholder with same name only once', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${foo} ${foo} ${2:bar}', false)
    await session.selectCurrentPlaceholder()
    await session.nextPlaceholder()
    await session.nextPlaceholder()
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 11 })
  })

  it('should start nest snippet without select', async () => {
    let buf = await helper.edit()
    await nvim.command('startinsert')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:a} ${2:b}')
    await helper.wait(30)
    await nvim.input('<backspace>')
    res = await session.start('${1:foo} ${2:bar}', false)
    await helper.wait(30)
    expect(res).toBe(true)
    let line = await nvim.line
    expect(line).toBe('foo bar b')
  })

  it('should select none transform placeholder', async () => {
    let buf = await helper.edit()
    await nvim.command('startinsert')
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1/..*/ -> /}xy$1')
    await helper.wait(30)
    let col = await nvim.call('col', '.')
    expect(col).toBe(3)
  })

  it('should indent multiple lines variable text', async () => {
    let text = 'abc\n  def'
    await nvim.setVar('coc_selected_text', text)
    let buf = await helper.edit()
    await nvim.input('i')
    let session = new SnippetSession(nvim, buf.id)
    await session.start('fun\n  ${0:${TM_SELECTED_TEXT:return}}\nend')
    await helper.wait(30)
    let lines = await buf.lines
    expect(lines.length).toBe(4)
    expect(lines).toEqual([
      'fun', '  abc', '    def', 'end'
    ])
  })
})

describe('SnippetSession#deactivate', () => {

  it('should deactivate on invalid change', async () => {
    let doc = await helper.createDocument()
    await nvim.input('i')
    let session = new SnippetSession(nvim, doc.bufnr)
    let res = await session.start('${1:a}bc')
    expect(res).toBe(true)
    let edit = {
      range: Range.create(0, 0, 0, 2),
      newText: ''
    }
    await doc.applyEdits([edit])
    await session.synchronizeUpdatedPlaceholders({ range: edit.range, text: edit.newText })
    expect(session.isActive).toBe(false)
  })

  it('should deactivate on cursor outside', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('a${1:a}b')
    expect(res).toBe(true)
    await buf.append(['foo', 'bar'])
    await nvim.call('cursor', [2, 1])
    await session.checkPosition()
    expect(session.isActive).toBe(false)
  })

  it('should cancel keymap on jump final placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
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

describe('SnippetSession#nextPlaceholder', () => {

  it('should goto next placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:a} ${2:b} c')
    expect(res).toBe(true)
    await session.nextPlaceholder()
    let { placeholder } = session
    expect(placeholder.index).toBe(2)
  })

  it('should jump to none transform placeholder', async () => {
    let buf = await helper.edit()
    await helper.wait(60)
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1} ${2/^_(.*)/$2/}bar$2')
    expect(res).toBe(true)
    let line = await nvim.line
    expect(line).toBe(' bar')
    await session.nextPlaceholder()
    await helper.wait(60)
    let col = await nvim.call('col', '.')
    expect(col).toBe(5)
  })
})

describe('SnippetSession#previousPlaceholder', () => {

  it('should goto previous placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:foo} ${2:bar}')
    expect(res).toBe(true)
    await session.nextPlaceholder()
    await helper.wait(60)
    expect(session.placeholder.index).toBe(2)
    await session.previousPlaceholder()
    await helper.wait(60)
    expect(session.placeholder.index).toBe(1)
  })
})

describe('SnippetSession#synchronizeUpdatedPlaceholders', () => {

  it('should adjust with line changed before start position', async () => {
    let buf = await helper.edit()
    await nvim.setLine('abd')
    await nvim.input('o')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:foo}')
    await helper.wait(30)
    expect(res).toBe(true)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 0, 0, 3),
      text: 'def'
    })
    expect(session.isActive).toBe(true)
  })

  it('should adjust for variable placeholders', async () => {
    let buf = await helper.edit()
    await nvim.input('i')
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${foo} ${foo}')
    expect(res).toBe(true)
    await session.selectCurrentPlaceholder()
    await helper.wait(100)
    await nvim.input('bar')
    await helper.wait(100)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 0, 0, 3),
      text: 'bar'
    })
    let line = await nvim.getLine()
    expect(line).toBe('bar bar')
  })

  it('should adjust with previous line change', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:foo}')
    await nvim.input('Obar')
    await helper.wait(30)
    expect(res).toBe(true)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 0, 0, 0),
      text: 'bar\n'
    })
    expect(session.isActive).toBe(true)
    let { start } = session.snippet.range
    expect(start).toEqual({ line: 1, character: 0 })
  })

  it('should adjust with previous character change', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('foo ${1:foo}')
    await nvim.input('Ibar')
    await helper.wait(30)
    expect(res).toBe(true)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 0, 0, 0),
      text: 'bar'
    })
    expect(session.isActive).toBe(true)
    let { start } = session.snippet.range
    expect(start).toEqual({ line: 0, character: 3 })
  })

  it('should deactivate when content add after snippet', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:foo} $0 ')
    await nvim.input('Abar')
    await helper.wait(100)
    expect(res).toBe(true)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 5, 0, 5),
      text: 'bar'
    })
    expect(session.isActive).toBe(false)
  })

  it('should not deactivate when content remove after snippet', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    let res = await session.start('${1:foo}')
    expect(res).toBe(true)
    await nvim.input('Abar')
    await helper.wait(30)
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 5, 0, 6),
      text: ''
    })
    await helper.wait(30)
    expect(session.isActive).toBe(true)
  })

  it('should deactivate when change outside placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('a${1:b}c')
    let doc = await workspace.document
    await doc.applyEdits([{
      range: Range.create(0, 0, 0, 1),
      newText: ''
    }])
    await session.synchronizeUpdatedPlaceholders({
      range: Range.create(0, 0, 0, 1),
      text: ''
    })
    expect(session.isActive).toBe(false)
  })

  it('should deactivate when jump to single final placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start(' $0 ${1:a}')
    await session.nextPlaceholder()
    expect(session.isActive).toBe(false)
  })
})

describe('SnippetSession#checkPosition', () => {

  it('should cancel snippet if position out of range', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await nvim.setLine('bar')
    await session.start('${1:foo}')
    await nvim.call('cursor', [1, 5])
    await session.checkPosition()
    expect(session.isActive).toBe(false)
  })

  it('should not cancel snippet if position in range', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1:foo}')
    await nvim.call('cursor', [1, 3])
    await session.checkPosition()
    expect(session.isActive).toBe(true)
  })
})

describe('SnippetSession#findPlaceholder', () => {

  it('should find current placeholder if possible', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1:abc}${2:def}')
    let placeholder = session.findPlaceholder(Range.create(0, 3, 0, 3))
    expect(placeholder.index).toBe(1)
  })

  it('should return null if placeholder not found', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1:abc}xyz${2:def}')
    let placeholder = session.findPlaceholder(Range.create(0, 4, 0, 4))
    expect(placeholder).toBeNull()
  })
})

describe('SnippetSession#selectPlaceholder', () => {

  it('should select range placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('${1:abc}')
    let mode = await nvim.mode
    expect(mode.mode).toBe('s')
    await nvim.input('<backspace>')
    let line = await nvim.line
    expect(line).toBe('')
  })

  it('should select empty placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await session.start('a ${1} ${2}')
    let mode = await nvim.mode
    expect(mode.mode).toBe('i')
    let col = await nvim.call('col', '.')
    expect(col).toBe(3)
  })

  it('should select choice placeholder', async () => {
    let buf = await helper.edit()
    let session = new SnippetSession(nvim, buf.id)
    await nvim.input('i')
    await session.start('${1|one,two,three|}')
    await helper.wait(60)
    let line = await nvim.line
    expect(line).toBe('one')
    let val = await nvim.eval('g:coc#_context') as any
    expect(val.start).toBe(0)
    expect(val.candidates).toEqual(['one', 'two', 'three'])
  })
})
