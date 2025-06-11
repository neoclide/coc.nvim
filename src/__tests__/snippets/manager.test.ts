import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { CompletionItem, Disposable, InsertTextFormat, InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import events from '../../events'
import languages from '../../languages'
import Document from '../../model/document'
import { CompletionItemProvider } from '../../provider'
import snippetManager, { SnippetManager } from '../../snippets/manager'
import { SnippetEdit } from '../../snippets/session'
import { SnippetString } from '../../snippets/string'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let doc: Document
let disposables: Disposable[] = []

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
  disposeAll(disposables)
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
      expect(snippetManager.isActivated(doc.bufnr)).toBe(true)
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
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      let isActive = await snippetManager.insertSnippet('${1:foo} $1 ', false, Range.create(0, 0, 0, 0))
      expect(isActive).toBe(true)
      let line = await nvim.line
      await nvim.call('cursor', [1, line.length + 1])
      await events.fire('InsertEnter', [doc.bufnr])
      expect(snippetManager.session.isActive).toBe(false)
    })

    it('should synchronize on CompleteDone', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foot\n')])
      await nvim.call('cursor', [2, 1])
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('${1/(.*)/${1:/capitalize}/}$1', true, Range.create(1, 0, 1, 0))
      expect(res).toBe(true)
      await snippetManager.selectCurrentPlaceholder()
      await nvim.input('f')
      await helper.waitPopup()
      let line = await nvim.line
      expect(line).toBe('f')
      await nvim.input('t')
      let s = snippetManager.session
      await doc.patchChange()
      events.completing = false
      await s.onCompleteDone()
      line = await nvim.line
      expect(line).toBe('Ftft')
      await nvim.input('<backspace>')
      await helper.waitValue(() => {
        return nvim.line
      }, 'Ff')
    })

    it('should show & hide status item', async () => {
      let doc = await workspace.document
      let buf = doc.buffer
      let curr = await helper.createDocument()
      await buf.setLines([], { start: 0, end: -1 })
      let isActive = await snippetManager.insertBufferSnippet(buf.id, ' ${1:foo} $1 $0', Range.create(0, 0, 0, 0))
      expect(isActive).toBe(true)
      let status = await nvim.getVar('coc_status')
      expect(!!status).toBe(false)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 1), 'x')])
      await helper.waitValue(() => doc.getline(0), ' xfoo xfoo ')
      let active = await buf.getVar('coc_snippet_active')
      expect(active).toBe(1)
      active = await curr.buffer.getVar('coc_snippet_active')
      expect(active != 1).toBe(true)
    })
  })

  describe('insertSnippet()', () => {
    it('should throw when current buffer not attached', async () => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      await expect(async () => {
        await snippetManager.insertSnippet('foo')
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
      expect(snippetManager.session.isActive).toBe(false)
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
      let s = new SnippetString()
      s.appendPlaceholder('bar')
      let active = await snippetManager.insertSnippet(s)
      expect(active).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('foo barbar')
    })

    it('should start nest session', async () => {
      await snippetManager.insertSnippet('${1:foo} ${2:bar}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
      await nvim.input('<backspace>i')
      let s = snippetManager.session
      await s.forceSynchronize()
      let active = await snippetManager.insertSnippet('${1:x} $1', true, undefined, undefined, {
        actions: {
          preExpand: 'vim.vars["last"] = snip.last_placeholder.current_text'
        }
      })
      expect(active).toBe(true)
      let last = await nvim.getVar('last')
      expect(last).toBe('i')
    })

    it('should insert nested snippet on CompleteDone with correct position', async () => {
      await snippetManager.insertSnippet('`!p snip.rv = " " * (10 - len(t[1]))`${1:inner}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let session = snippetManager.getSession(bufnr)
      expect(session.isActive).toBe(true)
      let line = await nvim.line
      expect(line).toBe('     inner')
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'bar',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, 5, 0, 6), newText: '${1:foobar}' },
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('b')
      await helper.waitPopup()
      let res = await helper.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      nvim.call('coc#pum#select', [idx, 1, 1], true)
      await events.race(['PlaceholderJump'], 200)
      await session.synchronize()
      line = await nvim.line
      expect(line).toBe('    foobar')
    })
  })

  describe('insertBufferSnippet()', () => {
    it('should throw when buffer not attached', async () => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      expect(snippetManager.jumpable()).toBe(false)
      let res = await snippetManager.resolveSnippet('${1:foo}')
      expect(res).toBeUndefined()
      await expect(async () => {
        await snippetManager.insertBufferSnippet(bufnr, 'foo', Range.create(0, 0, 0, 0))
      }).rejects.toThrow(Error)
    })
  })

  describe('insertBufferSnippets()', () => {
    it('should insert snippets', async () => {
      let doc = await helper.createDocument()
      await helper.createDocument()
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'foo($1)' })
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'bar($1)' })
      let result = await snippetManager.insertBufferSnippets(doc.bufnr, edits)
      expect(result).toBe(true)
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['foo()bar()'])
      await nvim.command(`b ${doc.bufnr}`)
      // selected on BufEnter
      await helper.waitFor('col', ['.'], 5)
    })

    it('should select placeholder', async () => {
      let doc = await workspace.document
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'foo($1)' })
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'bar($1)' })
      let result = await snippetManager.insertBufferSnippets(doc.bufnr, edits, true)
      expect(result).toBe(true)
      let cursor = await window.getCursorPosition()
      expect(cursor).toEqual(Position.create(0, 4))
    })
  })

  describe('nextPlaceholder()', () => {
    it('should go to next placeholder', async () => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await helper.doAction('snippetNext')
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should remove keymap on nextPlaceholder when session not exists', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      await events.fire('Enter', [])
      let buf = await nvim.buffer
      await nvim.call('coc#snippet#enable')
      await snippetManager.nextPlaceholder()
      let val = await buf.getVar('coc_snippet_active')
      expect(val).toBe(0)
    })

    it('should respect preferCompleteThanJumpPlaceholder', async () => {
      helper.updateConfiguration('suggest.preferCompleteThanJumpPlaceholder', true, disposables)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foot',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: '${1:foot}',
          textEdit: { range: Range.create(0, 0, 0, 0), newText: '${1:foot}' },
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'E', ['*'], provider))
      await snippetManager.insertSnippet('${1} ${2:bar} foot')
      let mode = await nvim.mode
      expect(mode.mode).toBe('i')
      nvim.call('coc#start', { source: 'edits' }, true)
      await helper.waitPopup()
      await nvim.input('<C-j>')
      await helper.waitFor('getline', ['.'], 'foot bar foot')
      let placeholder = snippetManager.session.placeholder
      expect(placeholder.index).toBe(1)
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

    it('should remove keymap on previousPlaceholder when session not exists', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      let buf = await nvim.buffer
      await nvim.call('coc#snippet#enable')
      await snippetManager.previousPlaceholder()
      let val = await buf.getVar('coc_snippet_active')
      expect(val).toBe(0)
    })
  })

  describe('cancel()', () => {
    it('should cancel snippet session', async () => {
      let buffer = doc.buffer
      let active = await snippetManager.insertSnippet('${1:foo}')
      expect(active).toBe(true)
      await helper.doAction('snippetCancel')
      expect(snippetManager.session.isActive).toBe(false)
      let val = await buffer.getVar('coc_snippet_active')
      expect(val).toBe(0)
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
      let doc = await workspace.document
      await nvim.command('startinsert')
      await snippetManager.insertSnippet('$1\n${1/,/|/g}', true, undefined, InsertTextMode.adjustIndentation, {})
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'a,b')])
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(['a,b', 'a|b'])
    })

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

    it('should not synchronize text on change final placeholder', async () => {
      let doc = await workspace.document
      await nvim.input('i')
      let res = await snippetManager.insertSnippet('$0e$1mpty$0')
      expect(res).toBe(true)
      await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 0, ['abc']])
      await doc.synchronize()
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let line = await nvim.line
      expect(line).toBe('abcempty')
    })
  })

  describe('resolveSnippet()', () => {
    it('should resolve snippet text', async () => {
      let snippet = await snippetManager.resolveSnippet('${1:foo}')
      expect(snippet.toString()).toBe('foo')
      snippet = await snippetManager.resolveSnippet('${1:foo} ${2:`!p snip.rv = "foo"`}', {})
      expect(snippet.toString()).toBe('foo foo')
    })

    it('should resolve python when have python snippet', async () => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('${1:foo} `!p snip.rv = t[1]`', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {}) as any
      expect(res).toBe(true)
      let snippet = await snippetManager.resolveSnippet('${1:x} `!p snip.rv= t[1]`', {})
      expect(snippet.toString()).toBe('x x')
    })

    it('should throw when resolve throw error', async () => {
      let s = snippetManager.session
      let spy = jest.spyOn(s, 'resolveSnippet').mockImplementation(() => {
        throw new Error('custom error')
      })
      await expect(() => {
        return snippetManager.resolveSnippet('${1:x}')
      }).rejects.toThrow(Error)
      spy.mockRestore()
    })
  })

  describe('normalizeInsertText()', () => {
    it('should normalizeInsertText', async () => {
      let doc = await workspace.document
      let res = await snippetManager.normalizeInsertText(doc.bufnr, 'foo\nbar', '  ', InsertTextMode.asIs)
      expect(res).toBe('foo\nbar')
    })

    it('should respect noExpand', async () => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('\t\t${1:foo}', true, Range.create(0, 0, 0, 0), InsertTextMode.adjustIndentation, {
        noExpand: true
      })
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('\t\tfoo')
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

  describe('Snippet context and actions', () => {
    describe('context', () => {
      it('should insert context snippet', async () => {
        await nvim.setLine('prefix')
        await nvim.input('A')
        let isActive = await snippetManager.insertSnippet('pre${1:foo} $0', true, undefined, undefined, {
          range: Range.create(0, 0, 0, 6),
          context: `True;vim.vars['before'] = snip.before`
        })
        expect(isActive).toBe(true)
        let before = await nvim.getVar('before')
        expect(before).toBe('prefix')
      })
    })

    describe('pre_expand', () => {
      it('should insert with pre_expand and user set cursor', async () => {
        await nvim.command('normal! gg')
        await nvim.setLine('foo')
        await nvim.input('A')
        await snippetManager.insertSnippet('$1 ${2:bar}', true, Range.create(0, 0, 0, 3), undefined, {
          actions: {
            preExpand: "snip.buffer[snip.line] = ' '*4; snip.cursor.set(snip.line, 4)"
          }
        })
        let line = await nvim.line
        expect(line).toBe('     bar')
        let pos = await window.getCursorPosition()
        expect(pos).toEqual({ line: 0, character: 4 })
        snippetManager.cancel()
      })

      it('should move to end of file with pre_expand', async () => {
        let buf = await nvim.buffer
        await buf.setLines(['x', 'foo'], { start: 0, end: 0 })
        await nvim.command('normal! gg')
        await nvim.input('A')
        await snippetManager.insertSnippet('def $1():', true, Range.create(0, 0, 0, 1), undefined, {
          actions: { preExpand: "del snip.buffer[snip.line]; snip.buffer.append(''); snip.cursor.set(len(snip.buffer)-1, 0)" }
        })
        let lines = await buf.lines
        expect(lines).toEqual(['foo', '', 'def ():'])
        let pos = await window.getCursorPosition()
        expect(pos).toEqual({ line: 2, character: 4 })
      })

      it('should insert line before with pre_expand', async () => {
        let buf = await nvim.buffer
        await nvim.setLine('foo')
        await nvim.command('normal! gg')
        await nvim.input('A')
        await snippetManager.insertSnippet('pre$1():', true, Range.create(0, 0, 0, 3), undefined, {
          actions: {
            preExpand: "snip.buffer[snip.line:snip.line] = [''];"
          }
        })
        let lines = await buf.lines
        expect(lines).toEqual(['', 'pre():'])
        let pos = await window.getCursorPosition()
        expect(pos).toEqual({ line: 1, character: 3 })
      })

      it('should insert snippetwith pre_expand as nested python snippet', async () => {
        await snippetManager.insertSnippet('`!p snip.rv = " " * (10 - len(t[1]))`${1:inner}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
        await nvim.setVar('coc_selected_text', 'bar')
        await snippetManager.insertSnippet('${1:foo}', true, Range.create(0, 5, 0, 10), undefined, {
          actions: {
            preExpand: 'vim.vars["v"] = snip.visual_content'
          }
        })
        let line = await nvim.line
        expect(line).toBe('       foo')
        let res = await nvim.getVar('v')
        expect(res).toBe('bar')
        let val = await nvim.getVar('coc_selected_text')
        expect(val).toBeNull()
      })
    })

    describe('post_expand', () => {
      it('should change snippet_start and snippet_end on lines change', async () => {
        let buf = await nvim.buffer
        await nvim.input('i')
        let codes = [
          "snip.buffer[0:0] = ['', '']",
          "vim.vars['first'] = [snip.snippet_start[0],snip.snippet_start[1],snip.snippet_end[0],snip.snippet_end[1]]",
          "snip.buffer[0:1] = []",
          "vim.vars['second'] = [snip.snippet_start[0],snip.snippet_start[1],snip.snippet_end[0],snip.snippet_end[1]]",
        ]
        let activated = await snippetManager.insertSnippet('pre$1():', true, Range.create(0, 0, 0, 0), undefined, {
          actions: { postExpand: codes.join(';') }
        })
        expect(activated).toBe(true)
        let first = await nvim.getVar('first')
        expect(first).toEqual([2, 0, 2, 6])
        let second = await nvim.getVar('second')
        expect(second).toEqual([1, 0, 1, 6])
        let lines = await buf.lines
        expect(lines).toEqual(['', 'pre():'])
      })

      it('should allow change after snippet', async () => {
        await nvim.input('i')
        let buf = await nvim.buffer
        // add two new lines
        let codes = [
          "snip.buffer[snip.snippet_end[0]+1:snip.snippet_end[0]+1] = ['', '']",
        ]
        await snippetManager.insertSnippet('def $1()', true, Range.create(0, 0, 0, 0), undefined, {
          actions: { postExpand: codes.join(';') }
        })
        let session = snippetManager.getSession(buf.id)
        expect(session.isActive).toBe(true)
        let lines = await buf.lines
        expect(lines).toEqual(['def ()', '', ''])
      })
    })

    describe('post_jump', () => {
      it('should insert before snippet', async () => {
        let buf = await nvim.buffer
        await nvim.input('i')
        let line = await nvim.call('line', ['.']) as number
        let codes = [
          'if snip.tabstop == 2: snip.buffer[0:0] = ["aa", "bb"];vim.vars["positions"] = [snip.snippet_start[0], snip.snippet_end[0]];vim.vars["direction"] = snip.jump_direction;',
        ]
        let activated = await snippetManager.insertSnippet('${1:foo} ${2:bar} $0', true, Range.create(line - 1, 0, line - 1, 0), undefined, {
          actions: { postJump: codes.join(';') }
        })
        expect(activated).toBe(true)
        await snippetManager.nextPlaceholder()
        await events.race(['PlaceholderJump'], 500)
        let lines = await buf.lines
        expect(lines).toEqual(['aa', 'bb', 'foo bar '])
        let positions = await nvim.getVar('positions')
        expect(positions).toEqual([2, 2])
        await snippetManager.previousPlaceholder()
      })

      it('should pass variables to snip', async () => {
        await nvim.input('o')
        let codes = [
          "vim.vars['positions'] = [snip.snippet_start[0],snip.snippet_start[1],snip.snippet_end[0],snip.snippet_end[1]]",
          "vim.vars['tabstop'] = snip.tabstop",
          "vim.vars['jump_direction'] = snip.jump_direction",
          "vim.vars['tabstops'] = str(snip.tabstops)",
        ]
        let activated = await snippetManager.insertSnippet('${1:foo} ${2:测试} $0', true, Range.create(1, 0, 1, 0), undefined, {
          actions: { postJump: codes.join(';') }
        })
        expect(activated).toBe(true)
        await events.race(['PlaceholderJump'], 200)
        let positions = await nvim.getVar('positions')
        expect(positions).toEqual([1, 0, 1, 7])
        let tabstop = await nvim.getVar('tabstop')
        expect(tabstop).toBe(1)
        let dir = await nvim.getVar('jump_direction')
        expect(dir).toBe(1)
        let tabstops = await nvim.getVar('tabstops')
        expect(tabstops).toMatch('测试')
        await snippetManager.nextPlaceholder()
        await snippetManager.previousPlaceholder()
      })
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
