import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { SnippetConfig, SnippetEdit, SnippetSession } from '../../snippets/session'
import { UltiSnippetContext } from '../../snippets/util'
import { Disposable, disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import { afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let nvim: Neovim
let disposables: Disposable[] = []
before(async () => {
  nvim = workspace.nvim
  let pyfile = path.join(import.meta.dirname, '../ultisnips.py')
  await nvim.command(`execute 'pyxfile '.fnameescape('${pyfile}')`)
})

afterEach(async () => {
  disposeAll(disposables)
})

async function createSession(enableHighlight = false, preferComplete = false, nextOnDelete = false): Promise<SnippetSession> {
  let doc = await workspace.document
  let config: SnippetConfig = { highlight: enableHighlight, preferComplete, nextOnDelete }
  let session = new SnippetSession(nvim, doc, config)
  disposables.push(session)
  disposables.push(workspace.onDidChangeTextDocument(e => {
    if (e.bufnr == session.bufnr) session.onChange(e)
  }))
  return session
}

afterEach(editorReset)

describe('SnippetSession', () => {
  const defaultRange = Range.create(0, 0, 0, 0)
  const defaultContext = {
    id: `1-1`,
    line: '',
    range: defaultRange
  }

  async function start(inserted: string, range = defaultRange, select = true, context?: UltiSnippetContext): Promise<boolean> {
    await nvim.input('i')
    let doc = await workspace.document
    let session = new SnippetSession(nvim, doc, { highlight: false, nextOnDelete: false, preferComplete: false })
    return await session.start(inserted, range, select, context)
  }

  async function getCursorRange(): Promise<Range> {
    let pos = await window.getCursorPosition()
    return Range.create(pos, pos)
  }

  describe('start()', () => {
    it('should not activate when insert empty snippet', async t => {
      let res = await start('', defaultRange)
      assert.strictEqual(res, false)
    })

    it('should insert escaped text', async t => {
      let res = await start('\\`a\\` \\$ \\{\\}', Range.create(0, 0, 0, 0), false, defaultContext)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, '`a` $ {}')
    })

    it('should not start with plain snippet when jump to final placeholder', async t => {
      let res = await start('bar$0', defaultRange)
      assert.strictEqual(res, false)
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 3 })
    })

    it('should start with range replaced', async t => {
      await nvim.setLine('foo')
      let res = await start('bar$0', Range.create(0, 0, 0, 3), true)
      assert.strictEqual(res, false)
      let line = await nvim.line
      assert.strictEqual(line, 'bar')
    })

    it('should fix indent of next line when necessary', async t => {
      let buf = await nvim.buffer
      await nvim.setLine('  ab')
      await nvim.input('i')
      let session = await createSession()
      await session.selectCurrentPlaceholder()
      let res = await session.start('${1:x}\n', Range.create(0, 3, 0, 3))
      assert.strictEqual(res, true)
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['  ax', '  b'])
    })

    it('should insert indent for snippet endsWith line break', async t => {
      let buf = await nvim.buffer
      await nvim.setLine('  bar')
      await nvim.command('startinsert')
      await nvim.call('cursor', [1, 3])
      let session = await createSession()
      let res = await session.start('${1:foo}\n', Range.create(0, 2, 0, 2))
      assert.strictEqual(res, true)
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['  foo', '  bar'])
    })

    it('should start without select placeholder', async t => {
      let session = await createSession()
      let res = await session.start(' ${1:aa} ', defaultRange, false)
      assert.strictEqual(res, true)
      let { mode } = await nvim.mode
      assert.strictEqual(mode, 'n')
      await session.selectCurrentPlaceholder()
      await shared.waitFor('mode', [], 's')
    })

    it('should use default variable value', async t => {
      let session = await createSession()
      let res = await session.start('${foo:bar}', defaultRange, false)
      assert.strictEqual(res, true)
      let line = await nvim.getLine()
      assert.strictEqual(line, 'bar')
    })

    it('should select none transform placeholder', async t => {
      await start('${1/..*/ -> /}xy$1', defaultRange)
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 3)
    })

    it('should indent multiple lines variable text', async t => {
      let buf = await nvim.buffer
      let text = 'abc\n  def'
      await nvim.setVar('coc_selected_text', text)
      await start('fun\n  ${0:${TM_SELECTED_TEXT:return}}\nend')
      let lines = await buf.lines
      assert.strictEqual(lines.length, 4)
      assert.deepStrictEqual(lines, [
        'fun', '  abc', '    def', 'end'
      ])
      let val = await nvim.getVar('coc_selected_text')
      assert.strictEqual(val, null)
    })

    it('should resolve VISUAL', async t => {
      let text = 'abc'
      await nvim.setVar('coc_selected_text', text)
      await start('$VISUAL')
      let line = await nvim.line
      assert.strictEqual(line, 'abc')
    })

    it('should resolve default value of VISUAL', async t => {
      await nvim.setVar('coc_selected_text', '')
      await start('${VISUAL:foo}')
      let line = await nvim.line
      assert.strictEqual(line, 'foo')
    })

    it('should fire onActiveChange when activate and deactivate', async t => {
      let session = await createSession()
      let events: boolean[] = []
      session.onActiveChange(v => {
        events.push(v)
      })
      await session.start('${1:foo}', defaultRange, false)
      assert.deepStrictEqual(events, [true])
      session.deactivate()
      assert.deepStrictEqual(events, [true, false])
    })
  })

  describe('insertSnippetEdits', () => {
    it('should insert snippets', async t => {
      await shared.createDocument()
      let session = await createSession()
      await shared.createDocument()
      let doc = session.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\n\nbar')])
      let res = await session.insertSnippetEdits([])
      assert.strictEqual(res, false)
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 3), snippet: 'foo($1)' })
      edits.push({ range: Range.create(2, 0, 2, 3), snippet: 'bar($1)' })
      res = await session.insertSnippetEdits(edits)
      assert.strictEqual(res, true)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['foo()', '', 'bar()'])
      let range = session.placeholder!.range
      assert.deepStrictEqual(range, Range.create(0, 4, 0, 4))
      let ses = await createSession()
      res = await ses.insertSnippetEdits([{ range: Range.create(0, 0, 0, 0), snippet: 'foo' }])
      assert.strictEqual(res, true)
      doc = ses.document
      let line = doc.getline(0)
      assert.strictEqual(line, 'foo')
      assert.strictEqual(ses.selected, false)
    })

    it('should keep independent snippet edit tabstop namespaces separate', async t => {
      let session = await createSession()
      let doc = session.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\n\nbar')])
      let edits: SnippetEdit[] = [
        { range: Range.create(0, 0, 0, 3), snippet: 'foo(${1:one})' },
        { range: Range.create(2, 0, 2, 3), snippet: 'bar(${1:two})' },
      ]
      let res = await session.insertSnippetEdits(edits)
      assert.strictEqual(res, true)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['foo(one)', '', 'bar(two)'])
      assert.deepStrictEqual(session.placeholder!.range, Range.create(0, 4, 0, 7))
      await nvim.call('cursor', [1, 5])
      await nvim.setLine('foo(first)')
      await doc.synchronize()
      await session.forceSynchronize()
      lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['foo(first)', '', 'bar(two)'])
    })

    it('should mirror same-index placeholders across multiple snippet edits (#5485)', async t => {
      let session = await createSession()
      let doc = session.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), [
        'fn main() {',
        '    loop {',
        '        break;',
        '        continue;',
        '    }',
        '}'
      ].join('\n'))])
      // edits produced by rust-analyzer "Add Label": the same placeholder
      // ${0:'l} is reused at every site so the three labels stay linked.
      let edits: SnippetEdit[] = [
        { range: Range.create(1, 4, 1, 4), snippet: "${0:'l}: " },
        { range: Range.create(2, 13, 2, 13), snippet: " ${0:'l}" },
        { range: Range.create(3, 16, 3, 16), snippet: " ${0:'l}" },
      ]
      let res = await session.insertSnippetEdits(edits)
      assert.strictEqual(res, true)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, [
        'fn main() {',
        "    'l: loop {",
        "        break 'l;",
        "        continue 'l;",
        '    }',
        '}'
      ])
      // selection is "'l" with no leading space, and it is a normal tabstop
      // (not the final $0) so the session stays active for editing
      assert.strictEqual(session.placeholder!.index, 1)
      assert.deepStrictEqual(session.placeholder!.range, Range.create(1, 4, 1, 6))
      // the three labels are mirrors of a single tabstop
      let ranges = session.snippet.getRanges(session.placeholder!.marker)
      assert.deepStrictEqual(ranges, [
        Range.create(1, 4, 1, 6),
        Range.create(2, 14, 2, 16),
        Range.create(3, 17, 3, 19),
      ])
      // editing the primary label syncs to every mirror
      await nvim.call('cursor', [2, 5])
      await nvim.setLine("    'outer: loop {")
      await doc.synchronize()
      await session.forceSynchronize()
      lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, [
        'fn main() {',
        "    'outer: loop {",
        "        break 'outer;",
        "        continue 'outer;",
        '    }',
        '}'
      ])
      // Tab from the label jumps to the final tabstop and ends the session
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, false)
    })

    it('should merge edits with a single editable final tabstop (#5485 old rust-analyzer)', async t => {
      let session = await createSession()
      let doc = session.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), [
        'fn main() {',
        '    loop {',
        '        break;',
        '        continue;',
        '    }',
        '}'
      ].join('\n'))])
      // rust-analyzer 2025-11 "Add Label" emits a single editable final
      // ${0:'l} on the last site, with regular tabstops on the earlier ones.
      let edits: SnippetEdit[] = [
        { range: Range.create(1, 4, 1, 4), snippet: "${1:'l}: " },
        { range: Range.create(2, 13, 2, 13), snippet: " ${2:'l}" },
        { range: Range.create(3, 16, 3, 16), snippet: " ${0:'l}" }
      ]
      let res = await session.insertSnippetEdits(edits)
      assert.strictEqual(res, true)
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, [
        'fn main() {',
        "    'l: loop {",
        "        break 'l;",
        "        continue 'l;",
        '    }',
        '}'
      ])
      // first placeholder selects exactly "'l", without trailing ": "
      assert.strictEqual(session.placeholder!.index, 1)
      assert.deepStrictEqual(session.placeholder!.range, Range.create(1, 4, 1, 6))
      // Tab navigates across edits with exact ranges, no trailing ";"
      await session.nextPlaceholder()
      assert.strictEqual(session.placeholder!.index, 2)
      assert.deepStrictEqual(session.placeholder!.range, Range.create(2, 14, 2, 16))
      await session.nextPlaceholder()
      assert.strictEqual(session.placeholder!.index, 3)
      assert.deepStrictEqual(session.placeholder!.range, Range.create(3, 17, 3, 19))
      // final jump reaches the appended $0 and ends the session
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, false)
    })
  })

  describe('nested snippet', () => {
    it('should start with nest snippet', async t => {
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b}', defaultRange, false)
      let line = await nvim.getLine()
      assert.strictEqual(line, 'a b')
      assert.strictEqual(res, true)
      let { placeholder } = session
      assert.strictEqual(placeholder.index, 1)
      res = await session.start('${1:foo} | ${2:bar}', defaultRange)
      assert.strictEqual(res, true)
      placeholder = session.placeholder
      assert.strictEqual(placeholder.value, 'foo')
      assert.strictEqual(placeholder.index, 1)
      line = await nvim.getLine()
      assert.strictEqual(line, 'foo | bara b')
      assert.strictEqual(session.snippet.text, 'foo | bara b')
      await session.nextPlaceholder()
      placeholder = session.placeholder
      assert.strictEqual(placeholder.index, 2)
      assert.strictEqual(session.placeholder.value, 'bar')
      let col = await nvim.call('col', ['.'])
      assert.strictEqual(col, 9)
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, true)
      // should finalize snippet
      assert.strictEqual(session.placeholder.index, 1)
      await session.nextPlaceholder()
      assert.strictEqual(session.placeholder.index, 2)
      assert.strictEqual(session.placeholder.value, 'b')
    })

    it('should start nest snippet without select', async t => {
      await nvim.command('startinsert')
      let session = await createSession()
      let res = await session.start('${1:a} $1', defaultRange)
      res = await session.start('${1:foo}', Range.create(0, 0, 0, 1), false)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, 'foo foo')
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      assert.notStrictEqual(session.placeholder, undefined)
    })

    it('should not nested when range not contains', async t => {
      await nvim.command('startinsert')
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b}', defaultRange)
      res = await session.start('${1:foo} ${2:bar}', Range.create(0, 0, 0, 3), false)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, 'foo bar')
    })

    it('should skip nested placeholder when its parent is replaced (#5424)', async t => {
      let session = await createSession()
      let res = await session.start('solid ${1:this.$2} $3;', defaultRange)
      assert.strictEqual(res, true)
      assert.strictEqual(session.placeholder.index, 1)
      // placeholder 1 contains nested $2, typing over the selection replaces it
      await nvim.input('some text')
      let line = await nvim.line
      assert.strictEqual(line, 'solid some text ;')
      await session.nextPlaceholder()
      // jump skips the replaced nested placeholder and lands on $3
      assert.strictEqual(session.isActive, true)
      assert.strictEqual(session.placeholder.index, 3)
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 16 })
    })

    it('should not nest when stale session range contains new snippet', async t => {
      await nvim.command('startinsert')
      let doc = await workspace.document
      let session = new SnippetSession(nvim, doc, { highlight: false, nextOnDelete: false, preferComplete: false })
      disposables.push(session)
      await session.start('if let ${1} = ${2:Some(()).and(optb)} {$0', defaultRange, false)

      // Undo can leave the snippet session active while the buffer has returned
      // to text that only happens to fall inside the old snippet range.
      await nvim.setLine('    Some(())')
      await doc.patchChange()
      assert.strictEqual(session.isActive, true)

      let res = await session.start('${1:Some(())}', Range.create(0, 4, 0, 12), false)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, '    Some(())')
      assert.strictEqual(session.snippet.text, 'Some(())')
    })
  })

  describe('getRanges()', () => {
    it('should getRanges of placeholder', async t => {
      async function checkRanges(snippet: string, results: any) {
        let session = await createSession()
        await session.start(snippet, defaultRange)
        let curr = session.placeholder
        let res = session.snippet.getRanges(curr.marker)
        assert.deepStrictEqual(res, results)
        session.deactivate()
        await nvim.setLine('')
      }
      await checkRanges('$1 $1', [])
      await checkRanges('${foo}', [Range.create(0, 0, 0, 3)])
      await checkRanges('${2:${1:foo}}', [Range.create(0, 0, 0, 3)])
      await checkRanges('${2:${1:foo}} ${2/^_(.*)/$1/}', [Range.create(0, 0, 0, 3)])
    })
  })

  describe('synchronize()', () => {
    it('should cancel when before and body changed', async t => {
      let session = await createSession()
      await nvim.setLine('x')
      await nvim.input('a')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('yfoo  bar')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, false)
    })

    it('should synchronize content change', async t => {
      let session = await createSession(true)
      await session.checkPosition()
      assert.strictEqual(session.version, -1)
      await session.start('${1:foo}${2:`!p snip.rv = ""`} `!p snip.rv = t[1] + t[2]`', defaultRange, true, {
        id: '1-1',
        line: '',
        range: defaultRange
      })
      await nvim.input('bar')
      await session.forceSynchronize()
      await shared.waitFor('getline', ['.'], 'bar bar')
    })

    it('should cancel with unexpected change', async t => {
      let session = await createSession(true)
      await nvim.setLine('c')
      await nvim.input('A')
      await session.start('${1:foo}', Range.create(0, 1, 0, 1))
      await nvim.setLine('bxoo')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, false)
    })

    it('should cancel when document have changed', async t => {
      let session = await createSession()
      let doc = await workspace.document
      await nvim.input('i')
      await session.start('${2:foo} ${1}', defaultRange)
      await nvim.setLine('bfoo ')
      await doc.patchChange()
      await nvim.setLine('xfoo ')
      await nvim.call('cursor', [1, 1])
      await session.forceSynchronize()
      assert.strictEqual(session.snippet.text, 'xfoo ')
      assert.strictEqual(session.isActive, true)
    })

    it('should keep sibling placeholder on non minimal content change', async t => {
      // A stale cursor reported by Vim during pending key mappings makes the
      // diff non-minimal: editing placeholder 1 reports a range that engulfs
      // the unchanged trailing text and placeholder 2. The change must be
      // reduced so placeholder 2 survives the jump (#5624).
      let session = await createSession()
      let doc = await workspace.document
      await nvim.input('i')
      await session.start('foo(${1:attrs}, ${2:x})', defaultRange)
      assert.strictEqual(session.placeholder.index, 1)
      await nvim.setLine('foo(a, x)')
      await doc.patchChange()
      await session.synchronize({
        version: doc.textDocument.version,
        change: { range: Range.create(0, 4, 0, 13), text: 'a, x)' }
      })
      assert.strictEqual(session.isActive, true)
      assert.strictEqual(session.snippet.text, 'foo(a, x)')
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, true)
      assert.strictEqual(session.placeholder.index, 2)
      assert.strictEqual(session.placeholder.value, 'x')
    })

    it('should reset snippet when cancelled', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} `!p snip.rv = t[1]`', defaultRange, false, defaultContext)
      await nvim.setLine('b ')
      let cancelled = false
      let spy = t.mock.method(session.snippet['_tmSnippet'], 'updatePythonCodes', () => {
        return new Promise<void>(resolve => {
          session.cancel()
          setImmediate(() => {
            resolve()
            cancelled = true
          })
        })
      })
      await shared.waitValue(() => cancelled, true)
      assert.strictEqual(session.snippet.text, ' ')
      await session.onCompleteDone()
    })

    it('should not cancel when change after snippet', async t => {
      let session = await createSession()
      await nvim.setLine(' x')
      await nvim.input('i')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('foo bar y')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
    })

    it('should cancel when change before and in snippet', async t => {
      let session = await createSession()
      await nvim.setLine(' x')
      await nvim.input('i')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('afoobar')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, false)
    })

    it('should not cancel when change text', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar', defaultRange)
      await nvim.setLine('foodbar')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      assert.strictEqual(session.snippet.text, 'foodbar')
    })

    it('should cancel via onTextChange', async t => {
      let session = await createSession()
      await session.start('${1:foo}', defaultRange, false)
      session.onTextChange()
      assert.strictEqual(session.isActive, true)
    })

    it('should able to jump when current placeholder destroyed', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar', defaultRange)
      await nvim.setLine('fobar')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, false)
    })

    it('should adjust with removed text', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar$0', defaultRange)
      await nvim.input('<esc>')
      await nvim.call('cursor', [1, 5])
      await nvim.input('i')
      await nvim.input('<backspace>')
      await shared.wait(20)
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      await session.nextPlaceholder()
      let col = await nvim.call('col', ['.'])
      assert.strictEqual(col, 7)
    })

    it('should automatically select next placeholder', async t => {
      let session = await createSession(false, false, true)
      await nvim.input('i')
      await session.start('${1:foo} bar$0', defaultRange)
      await nvim.input('<backspace>')
      await session.forceSynchronize()
      let placeholder = session.placeholder
      assert.strictEqual(placeholder.index, 0)
    })

    it('should changed none current placeholder', async t => {
      let session = await createSession()
      await nvim.input('i')
      await shared.waitFor('mode', [], 'i')
      await session.start('$1 $2', defaultRange)
      await shared.waitFor('mode', [], 'i')
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      await nvim.input('A')
      await shared.waitFor('mode', [], 'i')
      await nvim.input(' ')
      await shared.waitFor('getline', ['.'], '  ')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      let placeholder = session.snippet.getPlaceholderByIndex(2)
      assert.strictEqual(placeholder.value, ' ')
      let p = session.placeholder
      assert.strictEqual(p.index, 1)
    })

    it('should update cursor column after synchronize', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} ${1:foo}', defaultRange)
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, Position.create(0, 3))
      await nvim.input('a')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      let line = await nvim.line
      assert.deepStrictEqual(line, 'ba ba')
      assert.deepStrictEqual(pos, Position.create(0, 5))
      await nvim.input('<backspace>')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, Position.create(0, 3))
      line = await nvim.line
      assert.strictEqual(line, 'b b')
    })

    it('should update cursor line after synchronize', async t => {
      let buf = await nvim.buffer
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} ${1:foo}x', defaultRange)
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, Position.create(0, 3))
      await nvim.input('<cr>')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['b', ' b', 'x'])
      pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, Position.create(2, 0))
    })

    it('should synchronize changes at the same time', async t => {
      await nvim.input('i')
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('|$1 $1|', defaultRange)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, '| |')
      let p = new Promise(resolve => {
        doc.onDocumentChange(_e => {
          resolve(undefined)
        })
      })
      await nvim.input('xy')
      await p
      await doc.applyEdits([TextEdit.replace(Range.create(0, 1, 0, 3), '')])
      await session.forceSynchronize()
      line = await nvim.line
      assert.strictEqual(line, '| |')
    })

    it('should deactivate when synchronize text is wrong', async t => {
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('${1:foo}', defaultRange)
      assert.strictEqual(res, true)
      let spy = t.mock.method(session.snippet, 'replaceWithText', () => {
        return Promise.resolve({ snippetText: 'xy', marker: undefined })
      })
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'p')])
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, false)
    })

    it('should reset position when change before snippet', async t => {
      let session = await createSession()
      await nvim.setLine('x')
      await nvim.input('a')
      let r = await getCursorRange()
      await session.start('${1:foo} bar', r)
      await nvim.call('coc#cursor#move_to', [0, 0])
      await nvim.command('startinsert')
      await nvim.setLine('yfoo bar')
      await session.forceSynchronize()
      assert.strictEqual(session.isActive, true)
      let start = session.snippet.start
      assert.deepStrictEqual(start, Position.create(0, 1))
      session.deactivate()
    })

    it('should cancel change synchronize', async t => {
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('${1:foo}', defaultRange)
      assert.strictEqual(res, true)
      session.cancel(true)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 1), 'x')])
      process.nextTick(() => {
        session.cancel()
      })
      await session._synchronize()
      assert.strictEqual(session.snippet.tmSnippet.toString(), 'foo')
    })
  })

  describe('deactivate()', () => {
    it('should deactivate on cursor outside', async t => {
      let buf = await nvim.buffer
      let session = await createSession()
      let res = await session.start('a${1:a}b', defaultRange)
      assert.strictEqual(res, true)
      await buf.append(['foo', 'bar'])
      await nvim.call('cursor', [2, 2])
      await session.checkPosition()
      assert.strictEqual(session.isActive, false)
    })

    it('should not throw when selectPlaceholder called with undefined', async t => {
      let session = await createSession()
      await session.start('${1:foo}', defaultRange, false)
      await session.selectPlaceholder(undefined)
      assert.strictEqual(session.isActive, true)
    })

    it('should not throw when jump on deactivate session', async t => {
      let session = await createSession()
      session.deactivate()
      await session.start('${1:foo} $0', defaultRange)
      await session.selectPlaceholder(undefined)
      await session.forceSynchronize()
      await session.previousPlaceholder()
      await session.nextPlaceholder()
    })

    it('should cancel keymap on jump final placeholder', async t => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('$0x${1:a}b$0', defaultRange)
      let line = await nvim.line
      assert.strictEqual(line, 'xab')
      let map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      assert.match(map, new RegExp('coc#snippet#jump'))
      await session.nextPlaceholder()
      map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      assert.strictEqual(map, '')
    })
  })

  describe('nextPlaceholder()', () => {
    it('should not throw when session not activated', async t => {
      let session = await createSession()
      await session.start('${foo} ${bar}', defaultRange, false)
      session.deactivate()
      await session.nextPlaceholder()
      await session.previousPlaceholder()
    })

    it('should jump to variable placeholder', async t => {
      let session = await createSession()
      await session.start('${foo} ${bar}', defaultRange, false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 6 })
    })

    it('should jump to variable placeholder after number placeholder', async t => {
      let session = await createSession()
      await session.start('${foo} ${1:bar}', defaultRange, false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 2 })
    })

    it('should jump to first placeholder', async t => {
      let session = await createSession()
      await session.start('${foo} ${foo} ${2:bar}', defaultRange, false)
      await session.selectCurrentPlaceholder()
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 10 })
      await session.nextPlaceholder()
      pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 2 })
      await session.nextPlaceholder()
      pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, { line: 0, character: 11 })
    })

    it('should goto next placeholder', async t => {
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b} c', defaultRange)
      assert.strictEqual(res, true)
      await session.nextPlaceholder()
      let { placeholder } = session
      assert.strictEqual(placeholder.index, 2)
    })

    it('should jump to none transform placeholder', async t => {
      let session = await createSession()
      let res = await session.start('${1} ${2/^_(.*)/$2/}bar$2', defaultRange)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, ' bar')
      await session.nextPlaceholder()
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 5)
    })

    it('should remove white space on jump', async t => {
      let session = await createSession()
      let opts = {
        removeWhiteSpace: true,
        ...defaultContext
      }
      let res = await session.start('foo  $1\n${2:bar} $0', defaultRange, true, opts)
      assert.strictEqual(res, true)
      let line = await nvim.line
      assert.strictEqual(line, 'foo  ')
      await session.nextPlaceholder()
      assert.strictEqual(session.isActive, true)
      let lines = await session.document.buffer.lines
      assert.strictEqual(lines[0], 'foo')
      let p = session.placeholder
      await session.removeWhiteSpaceBefore(p)
    })
  })

  describe('previousPlaceholder()', () => {

    it('should goto previous placeholder', async t => {
      let session = await createSession()
      let res = await session.start('${1:foo} ${2:bar}', defaultRange)
      assert.strictEqual(res, true)
      await session.nextPlaceholder()
      assert.strictEqual(session.placeholder.index, 2)
      await session.previousPlaceholder()
      assert.strictEqual(session.placeholder.index, 1)
    })
  })

  describe('highlights()', () => {
    it('should add highlights', async t => {
      let ns = await nvim.call('coc#highlight#create_namespace', ['snippets']) as number
      let session = await createSession(true)
      await session.start('${2:bar ${1:foo}} $2', defaultRange)
      await session.nextPlaceholder()
      let buf = nvim.createBuffer(workspace.bufnr)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 2)
      assert.strictEqual(markers[0][3].hl_group, 'CocSnippetVisual')
      assert.strictEqual(markers[1][3].hl_group, 'CocSnippetVisual')
      session.deactivate()
    })
  })

  describe('checkPosition()', () => {

    it('should cancel snippet if position out of range', async t => {
      let session = await createSession()
      await nvim.setLine('bar')
      await session.start('${1:foo}', defaultRange)
      await nvim.call('cursor', [1, 5])
      await session.checkPosition()
      assert.strictEqual(session.isActive, false)
    })

    it('should not cancel snippet if position in range', async t => {
      let session = await createSession()
      await session.start('${1:foo}', defaultRange)
      await nvim.call('cursor', [1, 3])
      await session.checkPosition()
      assert.strictEqual(session.isActive, true)
    })
  })

  describe('resolveSnippet()', () => {
    it('should resolveSnippet', async t => {
      let session = await createSession()
      let res = await session.resolveSnippet(nvim, '${1:`!p snip.rv = "foo"`}', { line: 'foo', range: Range.create(0, 0, 0, 3) })
      assert.strictEqual(res, 'foo')
    })

    it('should skip python when noPython is true', async t => {
      let session = await createSession()
      let res = await session.resolveSnippet(nvim, 'plain', {
        line: '',
        range: Range.create(0, 0, 0, 0),
        noPython: true
      })
      assert.strictEqual(res, 'plain')
    })
  })

  describe('selectPlaceholder()', () => {
    it('should select range placeholder', async t => {
      let session = await createSession()
      await session.start('${1:abc}', defaultRange)
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 's')
      await nvim.input('<backspace>')
      let line = await nvim.line
      assert.strictEqual(line, '')
    })

    it('should select empty placeholder', async t => {
      let session = await createSession()
      await session.start('a ${1} ${2}', defaultRange)
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'i')
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 3)
    })

    it('should select choice placeholder', async t => {
      await nvim.input('i')
      let session = await createSession()
      await session.start('${1|one,two,three|}', defaultRange)
      let line = await nvim.line
      assert.strictEqual(line, 'one')
      await shared.waitPopup()
      let items = await shared.items()
      assert.strictEqual(items.length, 3)
    })
  })
})
