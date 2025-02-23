import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { InsertTextMode, Range, TextEdit } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import Document from '../../model/document'
import snippetManager, { SnippetManager } from '../../snippets/manager'
import { SnippetString } from '../../snippets/string'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let doc: Document
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  let pyfile = path.join(__dirname, '../ultisnips.py')
  await nvim.command(`execute 'pyxfile '.fnameescape('${pyfile}')`)
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
  describe('Events', () => {
    it('should change status item on editor change', async () => {
      let doc = await helper.createDocument('foo')
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      let val = await nvim.getVar('coc_status')
      expect(val).toBeDefined()
      await nvim.command('edit bar')
      await helper.waitValue(async () => {
        let val = await nvim.getVar('coc_status') as string
        return val.includes('SNIP')
      }, false)
      await nvim.command('buffer ' + doc.bufnr)
      await helper.waitValue(async () => {
        let val = await nvim.getVar('coc_status') as string
        return val.includes('SNIP')
      }, true)
    })

    it('should check position on InsertEnter', async () => {
      await nvim.input('ibar<left><left><left>')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      await nvim.input('<esc>A')
      await helper.wait(50)
      expect(snippetManager.session).toBeUndefined()
    })
  })

  describe('insertSnippet()', () => {
    it('should throw when buffer not attached', async () => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      await expect(async () => {
        await snippetManager.insertSnippet('foo')
      }).rejects.toThrow(Error)
    })

    it('should throw with invalid range', async () => {
      await expect(async () => {
        await snippetManager.insertSnippet('foo', false, Range.create(3, 0, 3, 0))
      }).rejects.toThrow(Error)
    })

    it('should replace range for ultisnip with python code', async () => {
      await nvim.setLine('foo')
      await snippetManager.insertSnippet('`!p snip.rv = vim.current.line`', false, Range.create(0, 0, 0, 3), InsertTextMode.asIs, {})
      let line = await nvim.line
      expect(line).toBe('')
      await helper.doAction('selectCurrentPlaceholder')
    })

    it('should not active when insert plain snippet', async () => {
      await snippetManager.insertSnippet('foo')
      let line = await nvim.line
      expect(line).toBe('foo')
      expect(snippetManager.session).toBe(undefined)
      expect(snippetManager.getSession(doc.bufnr)).toBeUndefined()
    })

    it('should insert snippet by action', async () => {
      await nvim.input('i')
      let res = await helper.plugin.cocAction('snippetInsert', Range.create(0, 0, 0, 0), '${1:foo}')
      expect(res).toBe(true)
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
      await helper.doAction('snippetNext')
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
      helper.updateConfiguration('suggest.preferCompleteThanJumpPlaceholder', true)
      let doc = await workspace.document
      await nvim.input('o')
      await snippetManager.insertSnippet('${1} ${2:bar} foot')
      await doc.synchronize()
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.call('coc#pum#select_confirm')
      await helper.waitFor('getline', ['.'], 'foot bar foot')
    })
  })

  describe('previousPlaceholder()', () => {
    it('should goto previous placeholder', async () => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await snippetManager.nextPlaceholder()
      await helper.doAction('snippetPrev')
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

  describe('cancel()', () => {
    it('should cancel snippet session', async () => {
      let buffer = doc.buffer
      await nvim.call('coc#snippet#enable')
      await helper.doAction('snippetCancel')
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
    it('should synchronize when position changed and pum visible', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      await nvim.input('o')
      let res = await snippetManager.insertSnippet("`!p snip.rv = ' '*(4- len(t[1]))`${1}", true, undefined, InsertTextMode.asIs, {})
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('    ')
      await nvim.input('f')
      await helper.waitFor('coc#pum#visible', [], 1)
      await nvim.input('<C-e>')
      let s = snippetManager.getSession(doc.bufnr)
      expect(s).toBeDefined()
    })

    it('should update placeholder on placeholder update', async () => {
      let doc = await workspace.document
      await nvim.input('i')
      await snippetManager.insertSnippet('$1\n${1/,/|/g}', true, undefined, InsertTextMode.adjustIndentation, {})
      await nvim.input('a,b')
      doc._forceSync()
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['a,b', 'a|b'])
    })

    it('should adjust cursor position on update', async () => {
      await nvim.call('cursor', [1, 1])
      await nvim.input('i')
      await snippetManager.insertSnippet('${1/..*/ -> /}$1')
      let line = await nvim.line
      expect(line).toBe('')
      await nvim.input('x')
      let s = snippetManager.getSession(doc.bufnr)
      expect(s).toBeDefined()
      await s.forceSynchronize()
      line = await nvim.line
      expect(line).toBe(' -> x')
      let col = await nvim.call('col', '.')
      expect(col).toBe(6)
    })

    it('should synchronize text on change final placeholder', async () => {
      let doc = await workspace.document
      await nvim.input('i')
      let res = await snippetManager.insertSnippet('$0empty$0')
      expect(res).toBe(true)
      await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 0, ['abc']])
      await doc.synchronize()
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
      snippet = await snippetManager.resolveSnippet('${1:foo} ${2:`!p snip.rv = "foo"`}', {})
      expect(snippet.toString()).toBe('foo foo')
    })

    it('should avoid python resolve when necessary', async () => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('${1:foo} `!p snip.rv = t[1]`', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {}) as any
      expect(res).toBe(true)
      let snippet = await snippetManager.resolveSnippet('${1:x} `!p snip.rv= t[1]`', {})
      expect(snippet.toString()).toBe('x x')
      res = await nvim.call('pyxeval', 't[1]') as any
      expect(res).toBe('x')
    })
  })

  describe('normalizeInsertText()', () => {
    it('should normalizeInsertText', async () => {
      let doc = await workspace.document
      Object.defineProperty(window, 'activeTextEditor', {
        get: () => {
          return undefined
        },
        configurable: true,
        enumerable: true
      })
      let res = await snippetManager.normalizeInsertText(doc.uri, 'foo\nbar', '  ', InsertTextMode.adjustIndentation)
      expect(res).toBe('foo\n  bar')
      Object.defineProperty(window, 'activeTextEditor', {
        get: () => {
          return workspace.editors.activeTextEditor
        }
      })
    })
  })

  describe('editsInsideSnippet()', () => {
    it('should check editsInsideSnippet', async () => {
      await nvim.setLine('foo')
      await nvim.input('o')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      let res = await snippetManager.editsInsideSnippet([TextEdit.replace(Range.create(0, 0, 0, 3), '')])
      expect(res).toBe(false)
    })
  })

  describe('insertSnippet command', () => {
    it('should insert ultisnips snippet', async () => {
      expect(SnippetManager).toBeDefined()
      await nvim.setLine('foo')
      let edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "bar"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, {})
      let line = await nvim.line
      expect(line).toBe('bar')
      edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "foo"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, { regex: '' })
      line = await nvim.line
      expect(line).toBe('foo')
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
