import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
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
import completion from '../../completion'

let nvim: Neovim
let doc: Document
let disposables: Disposable[] = []
before(async () => {
  nvim = workspace.nvim
  let pyfile = path.join(import.meta.dirname, '../ultisnips.py')
  await nvim.command(`execute 'pyxfile '.fnameescape('${pyfile}')`)
})

afterEach(async () => {
  disposeAll(disposables)
})

beforeEach(async () => {
  doc = await shared.createDocument()
})

afterEach(editorReset)

describe('snippet provider', () => {
  describe('Events', () => {
    it('should change status item on editor change', async t => {
      let doc = await shared.createDocument('foo')
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} $1 ')
      let val = await nvim.getVar('coc_status')
      assert.notStrictEqual(val, undefined)
      assert.strictEqual(snippetManager.isActivated(doc.bufnr), true)
      await nvim.command('edit bar')
      await shared.waitValue(async () => {
        let val = await nvim.getVar('coc_status') as string
        return val.includes('SNIP')
      }, false)
      await nvim.command('buffer ' + doc.bufnr)
      await shared.waitValue(async () => {
        let val = await nvim.getVar('coc_status') as string
        return val.includes('SNIP')
      }, true)
    })

    it('should check position on InsertEnter', async t => {
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      let isActive = await snippetManager.insertSnippet('${1:foo} $1 ', false, Range.create(0, 0, 0, 0))
      assert.strictEqual(isActive, true)
      let line = await nvim.line
      await nvim.call('cursor', [1, line.length + 1])
      await events.fire('InsertEnter', [doc.bufnr])
      assert.strictEqual(snippetManager.session.isActive, false)
    })

    it('should synchronize on CompleteDone', async t => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foot\n')])
      await nvim.call('cursor', [2, 1])
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('${1/(.*)/${1:/capitalize}/}$1', true, Range.create(1, 0, 1, 0))
      assert.strictEqual(res, true)
      await snippetManager.selectCurrentPlaceholder()
      await nvim.input('f')
      await shared.waitPopup()
      let line = await nvim.line
      assert.strictEqual(line, 'f')
      await nvim.input('t')
      let s = snippetManager.session
      await doc.patchChange()
      completion.cancelAndClose()
      await s.onCompleteDone()
      line = await nvim.line
      assert.strictEqual(line, 'Ftft')
      await nvim.input('<backspace>')
      await shared.waitValue(() => {
        return nvim.line
      }, 'Ff')
    })

    it('should show & hide status item', async t => {
      let doc = await workspace.document
      let buf = doc.buffer
      let curr = await shared.createDocument()
      await buf.setLines([], { start: 0, end: -1 })
      let isActive = await snippetManager.insertBufferSnippet(buf.id, ' ${1:foo} $1 $0', Range.create(0, 0, 0, 0))
      assert.strictEqual(isActive, true)
      let status = await nvim.getVar('coc_status')
      assert.strictEqual(!!status, false)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 1), 'x')])
      await shared.waitValue(() => doc.getline(0), ' xfoo xfoo ')
      let active = await buf.getVar('coc_snippet_active')
      assert.strictEqual(active, 1)
      active = await curr.buffer.getVar('coc_snippet_active')
      assert.strictEqual(active != 1, true)
    })
  })

  describe('insertSnippet()', () => {
    it('should throw when current buffer not attached', async t => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      await assert.rejects(snippetManager.insertSnippet('foo'), Error)
    })

    it('should replace range for ultisnip with python code', async t => {
      await nvim.setLine('foo')
      await snippetManager.insertSnippet('`!p snip.rv = vim.current.line`', false, Range.create(0, 0, 0, 3), InsertTextMode.asIs, {})
      let line = await nvim.line
      assert.strictEqual(line, '')
      await shared.doAction('selectCurrentPlaceholder')
    })

    it('should not active when insert plain snippet', async t => {
      await snippetManager.insertSnippet('foo')
      let line = await nvim.line
      assert.strictEqual(line, 'foo')
      assert.strictEqual(snippetManager.session.isActive, false)
      assert.strictEqual(snippetManager.getSession(doc.bufnr), undefined)
    })

    it('should insert snippet by action', async t => {
      await nvim.input('i')
      let res = await getCurrentPlugin().cocAction('snippetInsert', Range.create(0, 0, 0, 0), '${1:foo}')
      assert.strictEqual(res, true)
    })

    it('should start new session if session exists', async t => {
      await nvim.setLine('bar')
      await snippetManager.insertSnippet('${1:foo} ')
      await nvim.input('<esc>')
      await nvim.command('stopinsert')
      await nvim.input('A')
      let s = new SnippetString()
      s.appendPlaceholder('bar')
      let active = await snippetManager.insertSnippet(s)
      assert.strictEqual(active, true)
      let line = await nvim.getLine()
      assert.strictEqual(line, 'foo barbar')
    })

    it('should start nest session', async t => {
      await snippetManager.insertSnippet('${1:foo} ${2:bar}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
      await nvim.input('<backspace>i')
      let s = snippetManager.session
      await s.forceSynchronize()
      let active = await snippetManager.insertSnippet('${1:x} $1', true, undefined, undefined, {
        actions: {
          preExpand: 'vim.vars["last"] = snip.last_placeholder.current_text'
        }
      })
      assert.strictEqual(active, true)
      let last = await nvim.getVar('last')
      assert.strictEqual(last, 'i')
    })

    it('should insert nested snippet on CompleteDone with correct position', async t => {
      await snippetManager.insertSnippet('`!p snip.rv = " " * (10 - len(t[1]))`${1:inner}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let snipSession = snippetManager.getSession(bufnr)
      assert.strictEqual(snipSession.isActive, true)
      let line = await nvim.line
      assert.strictEqual(line, '     inner')
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
      await shared.waitPopup()
      let res = await shared.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      nvim.call('coc#pum#select', [idx, 1, 1], true)
      await events.race(['PlaceholderJump'], 200)
      await snipSession.synchronize()
      line = await nvim.line
      assert.strictEqual(line, '    foobar')
    })
  })

  describe('insertBufferSnippet()', () => {
    it('should throw when buffer not attached', async t => {
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      assert.strictEqual(snippetManager.jumpable(), false)
      let res = await snippetManager.resolveSnippet('${1:foo}')
      assert.strictEqual(res, undefined)
      await assert.rejects(snippetManager.insertBufferSnippet(bufnr, 'foo', Range.create(0, 0, 0, 0)), Error)
    })
  })

  describe('insertBufferSnippets()', () => {
    for (const [snippet, initialMode, expectedMode, expectedCol] of [
      ['let $0var_name = ', 'n', 'n', 5],
      ['let $0var_name = ', 'i', 'i', 5],
      ['let var_name = $0', 'n', 'n', 15],
      ['let var_name = $0', 'i', 'i', 16],
      ['let $1var_name = $0', 'n', 'i', 5],
      ['let ${1:x}var_name = $0', 'n', 's', 5],
      ['let ${0:x}var_name = ', 'n', 's', 5]
    ] as const) {
      it(`should preserve snippet edit modes: ${snippet} from ${initialMode} (#5750)`, async () => {
        if (initialMode === 'i') {
          await nvim.input('i')
          await shared.waitFor('mode', [], 'i')
        }
        await workspace.applyEdit({ documentChanges: [{
          textDocument: { uri: doc.uri, version: null },
          edits: [{ range: Range.create(0, 0, 0, 0), snippet: { kind: 'snippet', value: snippet } }]
        }] })
        await shared.waitFor('mode', [], expectedMode)
        assert.strictEqual(await nvim.call('col', '.'), expectedCol)
        if (expectedMode === 'n') {
          await nvim.input('ll')
          assert.strictEqual(await nvim.call('mode'), 'n')
          assert.strictEqual(await nvim.line, 'let var_name = ')
          assert.strictEqual(snippetManager.isActivated(doc.bufnr), false)
        }
      })
    }

    it('should insert snippets', async t => {
      let doc = await shared.createDocument()
      await shared.createDocument()
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'foo($1)' })
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'bar($1)' })
      let result = await snippetManager.insertBufferSnippets(doc.bufnr, edits)
      assert.strictEqual(result, true)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['foo()bar()'])
      await nvim.command(`b ${doc.bufnr}`)
      // selected on BufEnter
      await shared.waitFor('col', ['.'], 5)
    })

    it('should select placeholder', async t => {
      let doc = await workspace.document
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'foo($1)' })
      edits.push({ range: Range.create(0, 0, 0, 0), snippet: 'bar($1)' })
      let result = await snippetManager.insertBufferSnippets(doc.bufnr, edits, true)
      assert.strictEqual(result, true)
      let cursor = await window.getCursorPosition()
      assert.deepStrictEqual(cursor, Position.create(0, 4))
    })
  })

  describe('nextPlaceholder()', () => {
    it('should go to next placeholder', async t => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await shared.doAction('snippetNext')
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 3)
    })

    it('should remove keymap on nextPlaceholder when session not exists', async t => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      await events.fire('Enter', [])
      let buf = await nvim.buffer
      await nvim.call('coc#snippet#enable')
      await snippetManager.nextPlaceholder()
      let val = await buf.getVar('coc_snippet_active')
      assert.strictEqual(val, 0)
    })

    it('should respect preferCompleteThanJumpPlaceholder', async t => {
      shared.updateConfiguration('suggest.preferCompleteThanJumpPlaceholder', true, disposables)
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
      assert.strictEqual(mode.mode, 'i')
      nvim.call('coc#start', { source: 'edits' }, true)
      await shared.waitPopup()
      await nvim.input('<C-j>')
      await shared.waitFor('getline', ['.'], 'foot bar foot')
      let placeholder = snippetManager.session.placeholder
      assert.strictEqual(placeholder.index, 1)
    })
  })

  describe('previousPlaceholder()', () => {
    it('should goto previous placeholder', async t => {
      await snippetManager.insertSnippet('${1:a} ${2:b}')
      await snippetManager.nextPlaceholder()
      await shared.doAction('snippetPrev')
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 1)
    })

    it('should remove keymap on previousPlaceholder when session not exists', async t => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      let buf = await nvim.buffer
      await nvim.call('coc#snippet#enable')
      await snippetManager.previousPlaceholder()
      let val = await buf.getVar('coc_snippet_active')
      assert.strictEqual(val, 0)
    })
  })

  describe('cancel()', () => {
    it('should cancel snippet session', async t => {
      let buffer = doc.buffer
      let active = await snippetManager.insertSnippet('${1:foo}')
      assert.strictEqual(active, true)
      await shared.doAction('snippetCancel')
      assert.strictEqual(snippetManager.session.isActive, false)
      let val = await buffer.getVar('coc_snippet_active')
      assert.strictEqual(val, 0)
    })
  })

  describe('jumpable()', () => {
    it('should check jumpable', async t => {
      await nvim.input('i')
      await snippetManager.insertSnippet('${1:foo} ${2:bar}')
      let jumpable = snippetManager.jumpable()
      assert.strictEqual(jumpable, true)
      await snippetManager.nextPlaceholder()
      jumpable = snippetManager.jumpable()
      assert.strictEqual(jumpable, true)
      await snippetManager.nextPlaceholder()
      jumpable = snippetManager.jumpable()
      assert.strictEqual(jumpable, false)
    })
  })

  describe('synchronize text', () => {
    it('should update placeholder on placeholder update', async t => {
      let doc = await workspace.document
      await nvim.command('startinsert')
      await snippetManager.insertSnippet('$1\n${1/,/|/g}', true, undefined, InsertTextMode.adjustIndentation, {})
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'a,b')])
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let lines = await nvim.call('getline', [1, '$'])
      assert.deepStrictEqual(lines, ['a,b', 'a|b'])
    })

    it('should synchronize when position changed and pum visible', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      await nvim.input('o')
      let res = await snippetManager.insertSnippet("`!p snip.rv = ' '*(4- len(t[1]))`${1}", true, undefined, InsertTextMode.asIs, {})
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, '    ')
      await nvim.input('f')
      await shared.waitFor('coc#pum#visible', [], 1)
      await nvim.input('<C-e>')
      let s = snippetManager.getSession(doc.bufnr)
      assert.notStrictEqual(s, undefined)
    })

    it('should adjust cursor position on update', async t => {
      await nvim.call('cursor', [1, 1])
      await nvim.input('i')
      await snippetManager.insertSnippet('${1/..*/ -> /}$1')
      let line = await nvim.line
      assert.strictEqual(line, '')
      await nvim.input('x')
      let s = snippetManager.getSession(doc.bufnr)
      assert.notStrictEqual(s, undefined)
      await s.forceSynchronize()
      line = await nvim.line
      assert.strictEqual(line, ' -> x')
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 6)
    })

    it('should not synchronize text on change final placeholder', async t => {
      let doc = await workspace.document
      await nvim.input('i')
      let res = await snippetManager.insertSnippet('$0e$1mpty$0')
      assert.strictEqual(res, true)
      await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 0, ['abc']])
      await doc.synchronize()
      let s = snippetManager.getSession(doc.bufnr)
      await s.forceSynchronize()
      let line = await nvim.line
      assert.strictEqual(line, 'abcempty')
    })
  })

  describe('resolveSnippet()', () => {
    it('should resolve snippet text', async t => {
      let snippet = await snippetManager.resolveSnippet('${1:foo}')
      assert.strictEqual(snippet.toString(), 'foo')
      snippet = await snippetManager.resolveSnippet('${1:foo} ${2:`!p snip.rv = "foo"`}', {})
      assert.strictEqual(snippet.toString(), 'foo foo')
    })

    it('should resolve python when have python snippet', async t => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('${1:foo} `!p snip.rv = t[1]`', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {}) as any
      assert.strictEqual(res, true)
      let snippet = await snippetManager.resolveSnippet('${1:x} `!p snip.rv= t[1]`', {})
      assert.strictEqual(snippet.toString(), 'x x')
    })

    it('should throw when resolve throw error', async t => {
      let s = snippetManager.session
      let spy = t.mock.method(s, 'resolveSnippet', () => {
        throw new Error('custom error')
      })
      await assert.rejects(() => {
        return snippetManager.resolveSnippet('${1:x}')
      }, Error)
    })
  })

  describe('normalizeInsertText()', () => {
    it('should normalizeInsertText', async t => {
      let doc = await workspace.document
      let res = await snippetManager.normalizeInsertText(doc.bufnr, 'foo\nbar', '  ', InsertTextMode.asIs)
      assert.strictEqual(res, 'foo\nbar')
    })

    it('should respect noExpand', async t => {
      await nvim.command('startinsert')
      let res = await snippetManager.insertSnippet('\t\t${1:foo}', true, Range.create(0, 0, 0, 0), InsertTextMode.adjustIndentation, {
        noExpand: true
      })
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, '\t\tfoo')
    })
  })

  describe('insertSnippet command', () => {
    it('should insert ultisnips snippet', async t => {
      assert.notStrictEqual(SnippetManager, undefined)
      await nvim.setLine('foo')
      let edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "bar"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, {})
      let line = await nvim.line
      assert.strictEqual(line, 'bar')
      edit = TextEdit.replace(Range.create(0, 0, 0, 3), '${1:`echo "foo"`}')
      await commandManager.executeCommand('editor.action.insertSnippet', edit, { regex: '' })
      line = await nvim.line
      assert.strictEqual(line, 'foo')
    })
  })

  describe('Snippet context and actions', () => {
    describe('context', () => {
      it('should insert context snippet', async t => {
        await nvim.setLine('prefix')
        await nvim.input('A')
        let isActive = await snippetManager.insertSnippet('pre${1:foo} $0', true, undefined, undefined, {
          range: Range.create(0, 0, 0, 6),
          context: `True;vim.vars['before'] = snip.before`
        })
        assert.strictEqual(isActive, true)
        let before = await nvim.getVar('before')
        assert.strictEqual(before, 'prefix')
      })
    })

    describe('pre_expand', () => {
      it('should insert with pre_expand and user set cursor', async t => {
        await nvim.command('normal! gg')
        await nvim.setLine('foo')
        await nvim.input('A')
        await snippetManager.insertSnippet('$1 ${2:bar}', true, Range.create(0, 0, 0, 3), undefined, {
          actions: {
            preExpand: "snip.buffer[snip.line] = ' '*4; snip.cursor.set(snip.line, 4)"
          }
        })
        let line = await nvim.line
        assert.strictEqual(line, '     bar')
        let pos = await window.getCursorPosition()
        assert.deepStrictEqual(pos, { line: 0, character: 4 })
        snippetManager.cancel()
      })

      it('should move to end of file with pre_expand', async t => {
        let buf = await nvim.buffer
        await buf.setLines(['x', 'foo'], { start: 0, end: 0 })
        await nvim.command('normal! gg')
        await nvim.input('A')
        await snippetManager.insertSnippet('def $1():', true, Range.create(0, 0, 0, 1), undefined, {
          actions: { preExpand: "del snip.buffer[snip.line]; snip.buffer.append(''); snip.cursor.set(len(snip.buffer)-1, 0)" }
        })
        let lines = await buf.lines
        assert.deepStrictEqual(lines, ['foo', '', 'def ():'])
        let pos = await window.getCursorPosition()
        assert.deepStrictEqual(pos, { line: 2, character: 4 })
      })

      it('should insert line before with pre_expand', async t => {
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
        assert.deepStrictEqual(lines, ['', 'pre():'])
        let pos = await window.getCursorPosition()
        assert.deepStrictEqual(pos, { line: 1, character: 3 })
      })

      it('should insert snippetwith pre_expand as nested python snippet', async t => {
        await snippetManager.insertSnippet('`!p snip.rv = " " * (10 - len(t[1]))`${1:inner}', true, Range.create(0, 0, 0, 0), InsertTextMode.asIs, {})
        await nvim.setVar('coc_selected_text', 'bar')
        await snippetManager.insertSnippet('${1:foo}', true, Range.create(0, 5, 0, 10), undefined, {
          actions: {
            preExpand: 'vim.vars["v"] = snip.visual_content'
          }
        })
        let line = await nvim.line
        assert.strictEqual(line, '       foo')
        let res = await nvim.getVar('v')
        assert.strictEqual(res, 'bar')
        let val = await nvim.getVar('coc_selected_text')
        assert.strictEqual(val, null)
      })
    })

    describe('post_expand', () => {
      it('should change snippet_start and snippet_end on lines change', async t => {
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
        assert.strictEqual(activated, true)
        let first = await nvim.getVar('first')
        assert.deepStrictEqual(first, [2, 0, 2, 6])
        let second = await nvim.getVar('second')
        assert.deepStrictEqual(second, [1, 0, 1, 6])
        let lines = await buf.lines
        assert.deepStrictEqual(lines, ['', 'pre():'])
      })

      it('should allow change after snippet', async t => {
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
        assert.strictEqual(session.isActive, true)
        let lines = await buf.lines
        assert.deepStrictEqual(lines, ['def ()', '', ''])
      })
    })

    describe('post_jump', () => {
      it('should insert before snippet', async t => {
        let buf = await nvim.buffer
        await nvim.input('i')
        let line = await nvim.call('line', ['.']) as number
        let codes = [
          'if snip.tabstop == 2: snip.buffer[0:0] = ["aa", "bb"];vim.vars["positions"] = [snip.snippet_start[0], snip.snippet_end[0]];vim.vars["direction"] = snip.jump_direction;',
        ]
        let activated = await snippetManager.insertSnippet('${1:foo} ${2:bar} $0', true, Range.create(line - 1, 0, line - 1, 0), undefined, {
          actions: { postJump: codes.join(';') }
        })
        assert.strictEqual(activated, true)
        await snippetManager.nextPlaceholder()
        await events.race(['PlaceholderJump'], 500)
        let lines = await buf.lines
        assert.deepStrictEqual(lines, ['aa', 'bb', 'foo bar '])
        let positions = await nvim.getVar('positions')
        assert.deepStrictEqual(positions, [2, 2])
        await snippetManager.previousPlaceholder()
      })

      it('should pass variables to snip', async t => {
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
        assert.strictEqual(activated, true)
        await events.race(['PlaceholderJump'], 200)
        let positions = await nvim.getVar('positions')
        assert.deepStrictEqual(positions, [1, 0, 1, 7])
        let tabstop = await nvim.getVar('tabstop')
        assert.strictEqual(tabstop, 1)
        let dir = await nvim.getVar('jump_direction')
        assert.strictEqual(dir, 1)
        let tabstops = await nvim.getVar('tabstops')
        assert.match(String(tabstops), new RegExp('测试'))
        await snippetManager.nextPlaceholder()
        await snippetManager.previousPlaceholder()
      })
    })
  })

  describe('dispose()', () => {
    it('should dispose', async t => {
      let active = await snippetManager.insertSnippet('${1:foo}')
      assert.strictEqual(active, true)
      snippetManager.dispose()
      assert.strictEqual(snippetManager.session, undefined)
    })
  })
})
