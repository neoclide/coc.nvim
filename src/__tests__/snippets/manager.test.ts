import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Document from '../../model/document'
import snippetManager from '../../snippets/manager'
import { SnippetString } from '../../snippets/string'
import workspace from '../../workspace'
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
  describe('insertSnippet()', () => {
    it('should not active when insert plain snippet', async () => {
      await snippetManager.insertSnippet('foo')
      let line = await nvim.line
      expect(line).toBe('foo')
      expect(snippetManager.session).toBe(null)
      expect(snippetManager.getSession(doc.bufnr)).toBeUndefined()
      expect(snippetManager.isActived(doc.bufnr)).toBe(false)
    })

    it('should resolve variables', async () => {
      await snippetManager.insertSnippet('${foo:abcdef} ${bar}')
      let line = await nvim.line
      expect(line).toBe('abcdef bar')
    })

    it('should start new session if session exists', async () => {
      await nvim.setLine('bar')
      await snippetManager.insertSnippet('${1:foo} ')
      await helper.wait(100)
      await nvim.input('<esc>')
      await nvim.command('stopinsert')
      await nvim.input('A')
      await helper.wait(100)
      let active = await snippetManager.insertSnippet('${2:bar}')
      expect(active).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('foo barbar')
    })

    it('should start nest session', async () => {
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      await nvim.input('<backspace>')
      await helper.wait(100)
      let active = await snippetManager.insertSnippet('${1:x} $1')
      expect(active).toBe(true)
    })

    it('should not consider plaintext as placeholder', async () => {
      await snippetManager.insertSnippet('${1} ${2:bar}')
      await nvim.input('$foo;')
      await helper.wait(100)
      await snippetManager.insertSnippet('${1:x}', false, Range.create(0, 5, 0, 6))
      await helper.wait(100)
      let line = await nvim.line
      expect(line).toBe('$foo;xbar')
    })

    it('should insert nest plain snippet', async () => {
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      await nvim.input('<backspace>')
      await helper.wait(100)
      let active = await snippetManager.insertSnippet('bar')
      expect(active).toBe(true)
      let cursor = await nvim.call('coc#cursor#position')
      expect(cursor).toEqual([0, 3])
    })

    it('should work with nest snippet', async () => {
      let buf = await helper.edit()
      let snip = '<a ${1:http://www.${2:example.com}}>\n$0\n</a>'
      await snippetManager.insertSnippet(snip)
      await helper.wait(30)
      await nvim.input('abcde')
      await helper.wait(100)
      let lines = await buf.lines
      expect(lines).toEqual(['<a abcde>', '', '</a>'])
    })

    it('should insert snippetString', async () => {
      let snippetString = new SnippetString()
        .appendTabstop(1)
        .appendText(' ')
        .appendPlaceholder('bar', 2)
      await snippetManager.insertSnippet(snippetString)
      await nvim.input('$foo;')
      await helper.wait(100)
      snippetString = new SnippetString()
        .appendVariable('foo', 'x')
      await snippetManager.insertSnippet(snippetString, false, Range.create(0, 5, 0, 6))
      await helper.wait(100)
      let line = await nvim.line
      expect(line).toBe('$foo;xbar')
    })
  })

  describe('nextPlaceholder()', () => {
    it('should goto next placeholder', async () => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await snippetManager.nextPlaceholder()
      await helper.wait(30)
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should remove keymap on nextPlaceholder when session not exits', async () => {
      await nvim.call('coc#snippet#enable')
      await snippetManager.nextPlaceholder()
      await helper.wait(60)
      let val = await doc.buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
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
      await helper.wait(60)
      let val = await doc.buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
    })
  })

  describe('Events', () => {
    it('should check position on InsertEnter', async () => {
      await nvim.input('ibar<left><left><left>')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      await helper.wait(60)
      await nvim.input('<esc>A')
      await helper.wait(60)
      expect(snippetManager.session).toBeNull()
    })

  })

  describe('cancel()', () => {
    it('should cancel snippet session', async () => {
      let buffer = doc.buffer
      await nvim.call('coc#snippet#enable')
      snippetManager.cancel()
      await helper.wait(60)
      let val = await buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
      let active = await snippetManager.insertSnippet('${1:foo}')
      expect(active).toBe(true)
      snippetManager.cancel()
      expect(snippetManager.session).toBeNull()
    })
  })

  describe('configuration', () => {
    it('should respect preferCompleteThanJumpPlaceholder', async () => {
      let config = workspace.getConfiguration('suggest')
      config.update('preferCompleteThanJumpPlaceholder', true)
      await nvim.setLine('foo')
      await nvim.input('o')
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      await helper.wait(10)
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.input('<C-j>')
      await helper.wait(200)
      let line = await nvim.getLine()
      expect(line).toBe('foo bar')
      config.update('preferCompleteThanJumpPlaceholder', false)
    })
  })

  describe('jumpable()', () => {
    it('should check jumpable', async () => {
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      let jumpable = snippetManager.jumpable()
      expect(jumpable).toBe(true)
      await snippetManager.nextPlaceholder()
      await helper.wait(30)
      await snippetManager.nextPlaceholder()
      await helper.wait(30)
      jumpable = snippetManager.jumpable()
      expect(jumpable).toBe(false)
    })
  })

  describe('synchronize text', () => {
    it('should update placeholder on placeholder update', async () => {
      await snippetManager.insertSnippet('$1\n${1/,/,\\n/g}')
      await nvim.input('a,b')
      await helper.wait(50)
      doc.forceSync()
      await helper.wait(200)
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['a,b', 'a,', 'b'])
    })

    it('should adjust cursor position on update', async () => {
      await nvim.input('i')
      await snippetManager.insertSnippet('${1/..*/ -> /}$1')
      let line = await nvim.line
      expect(line).toBe('')
      await helper.wait(60)
      await nvim.input('x')
      await helper.wait(400)
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
      await helper.wait(50)
      await doc.patchChange()
      let line = await nvim.line
      expect(line).toBe('abcemptyabc')
    })

    it('should fix edit to current placeholder', async () => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('()$1$0', true)
      expect(res).toBe(true)
      await nvim.input('(')
      await nvim.input(')')
      await nvim.input('<Left>')
      await helper.wait(50)
      await doc.patchChange()
      await helper.wait(200)
      expect(snippetManager.session).toBeDefined()
    })
  })

  describe('resolveSnippet', () => {
    it('should resolve snippet', async () => {
      let fsPath = URI.parse(doc.uri).fsPath
      let res = await snippetManager.resolveSnippet(`$TM_FILENAME`)
      expect(res.toString()).toBe(path.basename(fsPath))
      res = await snippetManager.resolveSnippet(`$TM_FILENAME_BASE`)
      expect(res.toString()).toBe(path.basename(fsPath, path.extname(fsPath)))
      res = await snippetManager.resolveSnippet(`$TM_DIRECTORY`)
      expect(res.toString()).toBe(path.dirname(fsPath))
      res = await snippetManager.resolveSnippet(`$TM_FILEPATH`)
      expect(res.toString()).toBe(fsPath)
      await nvim.call('setreg', ['""', 'foo'])
      res = await snippetManager.resolveSnippet(`$YANK`)
      expect(res.toString()).toBe('foo')
      res = await snippetManager.resolveSnippet(`$TM_LINE_INDEX`)
      expect(res.toString()).toBe('0')
      res = await snippetManager.resolveSnippet(`$TM_LINE_NUMBER`)
      expect(res.toString()).toBe('1')
      await nvim.setLine('foo')
      res = await snippetManager.resolveSnippet(`$TM_CURRENT_LINE`)
      expect(res.toString()).toBe('foo')
      res = await snippetManager.resolveSnippet(`$TM_CURRENT_WORD`)
      expect(res.toString()).toBe('foo')
      await nvim.call('setreg', ['*', 'foo'])
      res = await snippetManager.resolveSnippet(`$CLIPBOARD`)
      expect(res.toString()).toBe('foo')
      let d = new Date()
      res = await snippetManager.resolveSnippet(`$CURRENT_YEAR`)
      expect(res.toString()).toBe(d.getFullYear().toString())
      res = await snippetManager.resolveSnippet(`$NOT_EXISTS`)
      expect(res.toString()).toBe('NOT_EXISTS')
    })
  })

  describe('dispose()', () => {
    it('should dispose', async () => {
      let active = await snippetManager.insertSnippet('${1:foo}')
      expect(active).toBe(true)
      snippetManager.dispose()
      expect(snippetManager.session).toBe(null)
    })
  })
})
