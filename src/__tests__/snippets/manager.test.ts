import { Neovim } from '@chemzqm/neovim'
import { InsertTextMode, Range, TextEdit } from 'vscode-languageserver-protocol'
import Document from '../../model/document'
import snippetManager from '../../snippets/manager'
import { SnippetString } from '../../snippets/string'
import workspace from '../../workspace'
import commandManager from '../../commands'
import helper from '../helper'

let nvim: Neovim
let doc: Document
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

beforeEach(async () => {
  doc = await helper.createDocument()
})

describe('snippet provider', () => {
  describe('insertSnippet command', () => {
    it('should insert ultisnips snippet', async () => {
      await nvim.setLine('foo')
      let edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "bar"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, true)
      let line = await nvim.line
      expect(line).toBe('bar')
      edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "foo"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, { regex: '' })
      line = await nvim.line
      expect(line).toBe('foo')
    })
  })

  describe('insertSnippet()', () => {
    it('should not active when insert plain snippet', async () => {
      await snippetManager.insertSnippet('foo')
      let line = await nvim.line
      expect(line).toBe('foo')
      expect(snippetManager.session).toBe(undefined)
      expect(snippetManager.getSession(doc.bufnr)).toBeUndefined()
    })

    it('should start new session if session exists', async () => {
      await nvim.setLine('bar')
      await snippetManager.insertSnippet('${1:foo} ')
      await nvim.input('<esc>')
      await nvim.command('stopinsert')
      await nvim.input('A')
      let active = await snippetManager.insertSnippet('${2:bar}')
      expect(active).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('foo barbar')
    })

    it('should start nest session', async () => {
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      await nvim.input('<backspace>')
      let active = await snippetManager.insertSnippet('${1:x} $1')
      expect(active).toBe(true)
    })

    it('should insert snippetString', async () => {
      let snippetString = new SnippetString()
        .appendTabstop(1)
        .appendText(' ')
        .appendPlaceholder('bar', 2)
      await snippetManager.insertSnippet(snippetString)
      await nvim.input('$foo;')
      snippetString = new SnippetString()
        .appendVariable('foo', 'x')
      await snippetManager.insertSnippet(snippetString, false, Range.create(0, 5, 0, 6))
      let line = await nvim.line
      expect(line).toBe('$foo;xbar')
    })
  })

  describe('nextPlaceholder()', () => {
    it('should goto next placeholder', async () => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await snippetManager.nextPlaceholder()
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should remove keymap on nextPlaceholder when session not exits', async () => {
      await nvim.call('coc#snippet#enable')
      await snippetManager.nextPlaceholder()
      let val = await doc.buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
    })

    it('should respect preferCompleteThanJumpPlaceholder', async () => {
      let config = workspace.getConfiguration('suggest')
      config.update('preferCompleteThanJumpPlaceholder', true)
      await nvim.setLine('foo')
      await nvim.input('o')
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      await nvim.input('f')
      await helper.waitPopup()
      await snippetManager.nextPlaceholder()
      await helper.waitFor('getline', ['.'], 'foo bar')
      config.update('preferCompleteThanJumpPlaceholder', false)
    })
  })

  describe('previousPlaceholder()', () => {
    it('should goto previous placeholder', async () => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await snippetManager.nextPlaceholder()
      await snippetManager.previousPlaceholder()
      let col = await nvim.call('col', '.')
      expect(col).toBe(1)
    })

    it('should remove keymap on previousPlaceholder when session not exits', async () => {
      await nvim.call('coc#snippet#enable')
      await snippetManager.previousPlaceholder()
      let val = await doc.buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
    })
  })

  describe('Events', () => {
    it('should check position on InsertEnter', async () => {
      await nvim.input('ibar<left><left><left>')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      await nvim.input('<esc>A')
      await helper.wait(50)
      expect(snippetManager.session).toBeUndefined()
    })

    it('should change status item on editor change', async () => {
      await nvim.command('tabe')
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      let val = await nvim.getVar('coc_status')
      expect(val).toBeDefined()
      await nvim.setTabpage(nvim.createTabpage(1))
      val = await nvim.getVar('coc_status') as string
      expect(val.includes('SNIP')).toBeFalsy()
    })
  })

  describe('cancel()', () => {
    it('should cancel snippet session', async () => {
      let buffer = doc.buffer
      await nvim.call('coc#snippet#enable')
      snippetManager.cancel()
      let val = await buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
      let active = await snippetManager.insertSnippet('${1:foo}')
      expect(active).toBe(true)
      snippetManager.cancel()
      expect(snippetManager.session).toBeUndefined()
    })
  })

  describe('jumpable()', () => {
    it('should check jumpable', async () => {
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      let jumpable = snippetManager.jumpable()
      expect(jumpable).toBe(true)
      await snippetManager.nextPlaceholder()
      jumpable = snippetManager.jumpable()
      expect(jumpable).toBe(true)
      await snippetManager.nextPlaceholder()
      jumpable = snippetManager.jumpable()
      expect(jumpable).toBe(false)
    })
  })

  describe('synchronize text', () => {
    it('should update placeholder on placeholder update', async () => {
      await snippetManager.insertSnippet('$1\n${1/,/|/g}', true, undefined, InsertTextMode.adjustIndentation, {})
      await nvim.input('a,b')
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['a,b', 'a|b'])
    })

    it('should adjust cursor position on update', async () => {
      await nvim.input('i')
      await snippetManager.insertSnippet('${1/..*/ -> /}$1')
      let line = await nvim.line
      expect(line).toBe('')
      await nvim.input('x')
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      line = await nvim.line
      expect(line).toBe(' -> x')
      let col = await nvim.call('col', '.')
      expect(col).toBe(6)
    })

    it('should synchronize text on change final placeholder', async () => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('$0empty$0')
      expect(res).toBe(true)
      await nvim.input('abc')
      await nvim.input('<esc>')
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let line = await nvim.line
      expect(line).toBe('abcemptyabc')
    })
  })

  describe('resolveSnippet()', () => {
    it('should resolve snippet text', async () => {
      let snippet = await snippetManager.resolveSnippet('${1:foo}')
      expect(snippet.toString()).toBe('foo')
      snippet = await snippetManager.resolveSnippet('${1:foo} ${2:`!p snip.rv = "foo"`}', true)
      expect(snippet.toString()).toBe('foo ')
    })
  })

  describe('dispose()', () => {
    it('should dispose', async () => {
      let active = await snippetManager.insertSnippet('${1:foo}')
      expect(active).toBe(true)
      snippetManager.dispose()
      expect(snippetManager.session).toBeUndefined()
    })
  })
})
