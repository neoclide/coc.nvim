import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { SnippetConfig, SnippetEdit, SnippetSession } from '../../snippets/session'
import { UltiSnippetContext } from '../../snippets/util'
import { Disposable, disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
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
    it('should not activate when insert empty snippet', async () => {
      let res = await start('', defaultRange)
      expect(res).toBe(false)
    })

    it('should insert escaped text', async () => {
      let res = await start('\\`a\\` \\$ \\{\\}', Range.create(0, 0, 0, 0), false, defaultContext)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('`a` $ {}')
    })

    it('should not start with plain snippet when jump to final placeholder', async () => {
      let res = await start('bar$0', defaultRange)
      expect(res).toBe(false)
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 3 })
    })

    it('should start with range replaced', async () => {
      await nvim.setLine('foo')
      let res = await start('bar$0', Range.create(0, 0, 0, 3), true)
      expect(res).toBe(false)
      let line = await nvim.line
      expect(line).toBe('bar')
    })

    it('should fix indent of next line when necessary', async () => {
      let buf = await nvim.buffer
      await nvim.setLine('  ab')
      await nvim.input('i')
      let session = await createSession()
      await session.selectCurrentPlaceholder()
      let res = await session.start('${1:x}\n', Range.create(0, 3, 0, 3))
      expect(res).toBe(true)
      let lines = await buf.lines
      expect(lines).toEqual(['  ax', '  b'])
    })

    it('should insert indent for snippet endsWith line break', async () => {
      let buf = await nvim.buffer
      await nvim.setLine('  bar')
      await nvim.command('startinsert')
      await nvim.call('cursor', [1, 3])
      let session = await createSession()
      let res = await session.start('${1:foo}\n', Range.create(0, 2, 0, 2))
      expect(res).toBe(true)
      let lines = await buf.lines
      expect(lines).toEqual(['  foo', '  bar'])
    })

    it('should start without select placeholder', async () => {
      let session = await createSession()
      let res = await session.start(' ${1:aa} ', defaultRange, false)
      expect(res).toBe(true)
      let { mode } = await nvim.mode
      expect(mode).toBe('n')
      await session.selectCurrentPlaceholder()
      await helper.waitFor('mode', [], 's')
    })

    it('should use default variable value', async () => {
      let session = await createSession()
      let res = await session.start('${foo:bar}', defaultRange, false)
      expect(res).toBe(true)
      let line = await nvim.getLine()
      expect(line).toBe('bar')
    })

    it('should select none transform placeholder', async () => {
      await start('${1/..*/ -> /}xy$1', defaultRange)
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should indent multiple lines variable text', async () => {
      let buf = await nvim.buffer
      let text = 'abc\n  def'
      await nvim.setVar('coc_selected_text', text)
      await start('fun\n  ${0:${TM_SELECTED_TEXT:return}}\nend')
      let lines = await buf.lines
      expect(lines.length).toBe(4)
      expect(lines).toEqual([
        'fun', '  abc', '    def', 'end'
      ])
      let val = await nvim.getVar('coc_selected_text')
      expect(val).toBe(null)
    })

    it('should resolve VISUAL', async () => {
      let text = 'abc'
      await nvim.setVar('coc_selected_text', text)
      await start('$VISUAL')
      let line = await nvim.line
      expect(line).toBe('abc')
    })

    it('should resolve default value of VISUAL', async () => {
      await nvim.setVar('coc_selected_text', '')
      await start('${VISUAL:foo}')
      let line = await nvim.line
      expect(line).toBe('foo')
    })
  })

  describe('insertSnippetEdits', () => {
    it('should insert snippets', async () => {
      await helper.createDocument()
      let session = await createSession()
      await helper.createDocument()
      let doc = session.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\n\nbar')])
      let res = await session.insertSnippetEdits([])
      expect(res).toBe(false)
      let edits: SnippetEdit[] = []
      edits.push({ range: Range.create(0, 0, 0, 3), snippet: 'foo($1)' })
      edits.push({ range: Range.create(2, 0, 2, 3), snippet: 'bar($1)' })
      res = await session.insertSnippetEdits(edits)
      expect(res).toBe(true)
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['foo()', '', 'bar()'])
      let range = session.placeholder!.range
      expect(range).toEqual(Range.create(0, 4, 0, 4))
      let ses = await createSession()
      res = await ses.insertSnippetEdits([{ range: Range.create(0, 0, 0, 0), snippet: 'foo' }])
      expect(res).toBe(true)
      doc = ses.document
      let line = doc.getline(0)
      expect(line).toBe('foo')
      expect(ses.selected).toBe(false)
    })
  })

  describe('nested snippet', () => {
    it('should start with nest snippet', async () => {
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b}', defaultRange, false)
      let line = await nvim.getLine()
      expect(line).toBe('a b')
      expect(res).toBe(true)
      let { placeholder } = session
      expect(placeholder.index).toBe(1)
      res = await session.start('${1:foo} | ${2:bar}', defaultRange)
      expect(res).toBe(true)
      placeholder = session.placeholder
      expect(placeholder.value).toBe('foo')
      expect(placeholder.index).toBe(1)
      line = await nvim.getLine()
      expect(line).toBe('foo | bara b')
      expect(session.snippet.text).toBe('foo | bara b')
      await session.nextPlaceholder()
      placeholder = session.placeholder
      expect(placeholder.index).toBe(2)
      expect(session.placeholder.value).toBe('bar')
      let col = await nvim.call('col', ['.'])
      expect(col).toBe(9)
      await session.nextPlaceholder()
      expect(session.isActive).toBe(true)
      // should finalize snippet
      expect(session.placeholder.index).toBe(1)
      await session.nextPlaceholder()
      expect(session.placeholder.index).toBe(2)
      expect(session.placeholder.value).toBe('b')
    })

    it('should start nest snippet without select', async () => {
      await nvim.command('startinsert')
      let session = await createSession()
      let res = await session.start('${1:a} $1', defaultRange)
      res = await session.start('${1:foo}', Range.create(0, 0, 0, 1), false)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('foo foo')
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      expect(session.placeholder).toBeDefined()
    })

    it('should not nested when range not contains', async () => {
      await nvim.command('startinsert')
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b}', defaultRange)
      res = await session.start('${1:foo} ${2:bar}', Range.create(0, 0, 0, 3), false)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('foo bar')
    })
  })

  describe('getRanges()', () => {
    it('should getRanges of placeholder', async () => {
      async function checkRanges(snippet: string, results: any) {
        let session = await createSession()
        await session.start(snippet, defaultRange)
        let curr = session.placeholder
        let res = session.snippet.getRanges(curr.marker)
        expect(res).toEqual(results)
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
    it('should cancel when before and body changed', async () => {
      let session = await createSession()
      await nvim.setLine('x')
      await nvim.input('a')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('yfoo  bar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should synchronize content change', async () => {
      let session = await createSession(true)
      await session.checkPosition()
      expect(session.version).toBe(-1)
      await session.start('${1:foo}${2:`!p snip.rv = ""`} `!p snip.rv = t[1] + t[2]`', defaultRange, true, {
        id: '1-1',
        line: '',
        range: defaultRange
      })
      await nvim.input('bar')
      await session.forceSynchronize()
      await helper.waitFor('getline', ['.'], 'bar bar')
    })

    it('should cancel with unexpected change', async () => {
      let session = await createSession(true)
      await nvim.setLine('c')
      await nvim.input('A')
      await session.start('${1:foo}', Range.create(0, 1, 0, 1))
      await nvim.setLine('bxoo')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should cancel when document have changed', async () => {
      let session = await createSession()
      let doc = await workspace.document
      await nvim.input('i')
      await session.start('${2:foo} ${1}', defaultRange)
      await nvim.setLine('bfoo ')
      await doc.patchChange()
      await nvim.setLine('xfoo ')
      await nvim.call('cursor', [1, 1])
      await session.forceSynchronize()
      expect(session.snippet.text).toBe('xfoo ')
      expect(session.isActive).toBe(true)
    })

    it('should reset snippet when cancelled', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} `!p snip.rv = t[1]`', defaultRange, false, defaultContext)
      await nvim.setLine('b ')
      let cancelled = false
      let spy = jest.spyOn(session.snippet['_tmSnippet'], 'updatePythonCodes').mockImplementation(() => {
        return new Promise(resolve => {
          session.cancel()
          setImmediate(() => {
            resolve()
            cancelled = true
          })
        })
      })
      await helper.waitValue(() => cancelled, true)
      expect(session.snippet.text).toBe(' ')
      spy.mockRestore()
      await session.onCompleteDone()
    })

    it('should not cancel when change after snippet', async () => {
      let session = await createSession()
      await nvim.setLine(' x')
      await nvim.input('i')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('foo bar y')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
    })

    it('should cancel when change before and in snippet', async () => {
      let session = await createSession()
      await nvim.setLine(' x')
      await nvim.input('i')
      await session.start('${1:foo }bar', defaultRange)
      await nvim.setLine('afoobar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(false)
    })

    it('should not cancel when change text', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar', defaultRange)
      await nvim.setLine('foodbar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      expect(session.snippet.text).toBe('foodbar')
    })

    it('should able to jump when current placeholder destroyed', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar', defaultRange)
      await nvim.setLine('fobar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      await session.nextPlaceholder()
      expect(session.isActive).toBe(false)
    })

    it('should adjust with removed text', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1:foo} bar$0', defaultRange)
      await nvim.input('<esc>')
      await nvim.call('cursor', [1, 5])
      await nvim.input('i')
      await nvim.input('<backspace>')
      await helper.wait(1)
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      await session.nextPlaceholder()
      let col = await nvim.call('col', ['.'])
      expect(col).toBe(7)
    })

    it('should automatically select next placeholder', async () => {
      let session = await createSession(false, false, true)
      await nvim.input('i')
      await session.start('${1:foo} bar$0', defaultRange)
      await nvim.input('<backspace>')
      await session.forceSynchronize()
      let placeholder = session.placeholder
      expect(placeholder.index).toBe(0)
    })

    it('should changed none current placeholder', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('$1 $2', defaultRange)
      await nvim.input('<esc>A')
      await nvim.input(' ')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      let placeholder = session.snippet.getPlaceholderByIndex(2)
      expect(placeholder.value).toBe(' ')
      let p = session.placeholder
      expect(p.index).toBe(1)
    })

    it('should update cursor column after synchronize', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} ${1:foo}', defaultRange)
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
      await nvim.input('a')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      let line = await nvim.line
      expect(line).toEqual('ba ba')
      expect(pos).toEqual(Position.create(0, 5))
      await nvim.input('<backspace>')
      await session.forceSynchronize()
      pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
      line = await nvim.line
      expect(line).toBe('b b')
    })

    it('should update cursor line after synchronize', async () => {
      let buf = await nvim.buffer
      let session = await createSession()
      await nvim.input('i')
      await session.start('${1} ${1:foo}x', defaultRange)
      await nvim.input('b')
      await session.forceSynchronize()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(0, 3))
      await nvim.input('<cr>')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      let lines = await buf.lines
      expect(lines).toEqual(['b', ' b', 'x'])
      pos = await window.getCursorPosition()
      expect(pos).toEqual(Position.create(2, 0))
    })

    it('should synchronize changes at the same time', async () => {
      await nvim.input('i')
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('|$1 $1|', defaultRange)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('| |')
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
      expect(line).toBe('| |')
    })

    it('should deactivate when synchronize text is wrong', async () => {
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('${1:foo}', defaultRange)
      expect(res).toBe(true)
      let spy = jest.spyOn(session.snippet, 'replaceWithText').mockImplementation(() => {
        return Promise.resolve({ snippetText: 'xy', marker: undefined })
      })
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'p')])
      await session.forceSynchronize()
      spy.mockRestore()
      expect(session.isActive).toBe(false)
    })

    it('should reset position when change before snippet', async () => {
      let session = await createSession()
      await nvim.setLine('x')
      await nvim.input('a')
      let r = await getCursorRange()
      await session.start('${1:foo} bar', r)
      await nvim.call('coc#cursor#move_to', [0, 0])
      await nvim.command('startinsert')
      await nvim.setLine('yfoo bar')
      await session.forceSynchronize()
      expect(session.isActive).toBe(true)
      let start = session.snippet.start
      expect(start).toEqual(Position.create(0, 1))
      session.deactivate()
    })

    it('should cancel change synchronize', async () => {
      let doc = await workspace.document
      let session = await createSession()
      let res = await session.start('${1:foo}', defaultRange)
      expect(res).toBe(true)
      session.cancel(true)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 1), 'x')])
      process.nextTick(() => {
        session.cancel()
      })
      await session._synchronize()
      expect(session.snippet.tmSnippet.toString()).toBe('foo')
    })
  })

  describe('deactivate()', () => {
    it('should deactivate on cursor outside', async () => {
      let buf = await nvim.buffer
      let session = await createSession()
      let res = await session.start('a${1:a}b', defaultRange)
      expect(res).toBe(true)
      await buf.append(['foo', 'bar'])
      await nvim.call('cursor', [2, 2])
      await session.checkPosition()
      expect(session.isActive).toBe(false)
    })

    it('should not throw when jump on deactivate session', async () => {
      let session = await createSession()
      session.deactivate()
      await session.start('${1:foo} $0', defaultRange)
      await session.selectPlaceholder(undefined)
      await session.forceSynchronize()
      await session.previousPlaceholder()
      await session.nextPlaceholder()
    })

    it('should cancel keymap on jump final placeholder', async () => {
      let session = await createSession()
      await nvim.input('i')
      await session.start('$0x${1:a}b$0', defaultRange)
      let line = await nvim.line
      expect(line).toBe('xab')
      let map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      expect(map).toMatch('coc#snippet#jump')
      await session.nextPlaceholder()
      map = await nvim.call('maparg', ['<C-j>', 'i']) as string
      expect(map).toBe('')
    })
  })

  describe('nextPlaceholder()', () => {
    it('should not throw when session not activated', async () => {
      let session = await createSession()
      await session.start('${foo} ${bar}', defaultRange, false)
      session.deactivate()
      await session.nextPlaceholder()
      await session.previousPlaceholder()
    })

    it('should jump to variable placeholder', async () => {
      let session = await createSession()
      await session.start('${foo} ${bar}', defaultRange, false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 6 })
    })

    it('should jump to variable placeholder after number placeholder', async () => {
      let session = await createSession()
      await session.start('${foo} ${1:bar}', defaultRange, false)
      await session.selectCurrentPlaceholder()
      await session.nextPlaceholder()
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({ line: 0, character: 2 })
    })

    it('should jump to first placeholder', async () => {
      let session = await createSession()
      await session.start('${foo} ${foo} ${2:bar}', defaultRange, false)
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
      let session = await createSession()
      let res = await session.start('${1:a} ${2:b} c', defaultRange)
      expect(res).toBe(true)
      await session.nextPlaceholder()
      let { placeholder } = session
      expect(placeholder.index).toBe(2)
    })

    it('should jump to none transform placeholder', async () => {
      let session = await createSession()
      let res = await session.start('${1} ${2/^_(.*)/$2/}bar$2', defaultRange)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe(' bar')
      await session.nextPlaceholder()
      let col = await nvim.call('col', '.')
      expect(col).toBe(5)
    })

    it('should remove white space on jump', async () => {
      let session = await createSession()
      let opts = {
        removeWhiteSpace: true,
        ...defaultContext
      }
      let res = await session.start('foo  $1\n${2:bar} $0', defaultRange, true, opts)
      expect(res).toBe(true)
      let line = await nvim.line
      expect(line).toBe('foo  ')
      await session.nextPlaceholder()
      expect(session.isActive).toBe(true)
      let lines = await session.document.buffer.lines
      expect(lines[0]).toBe('foo')
      let p = session.placeholder
      await session.removeWhiteSpaceBefore(p)
    })
  })

  describe('previousPlaceholder()', () => {

    it('should goto previous placeholder', async () => {
      let session = await createSession()
      let res = await session.start('${1:foo} ${2:bar}', defaultRange)
      expect(res).toBe(true)
      await session.nextPlaceholder()
      expect(session.placeholder.index).toBe(2)
      await session.previousPlaceholder()
      expect(session.placeholder.index).toBe(1)
    })
  })

  describe('highlights()', () => {
    it('should add highlights', async () => {
      let ns = await nvim.call('coc#highlight#create_namespace', ['snippets']) as number
      let session = await createSession(true)
      await session.start('${2:bar ${1:foo}} $2', defaultRange)
      await session.nextPlaceholder()
      let buf = nvim.createBuffer(workspace.bufnr)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(2)
      expect(markers[0][3].hl_group).toBe('CocSnippetVisual')
      expect(markers[1][3].hl_group).toBe('CocSnippetVisual')
      session.deactivate()
    })
  })

  describe('checkPosition()', () => {

    it('should cancel snippet if position out of range', async () => {
      let session = await createSession()
      await nvim.setLine('bar')
      await session.start('${1:foo}', defaultRange)
      await nvim.call('cursor', [1, 5])
      await session.checkPosition()
      expect(session.isActive).toBe(false)
    })

    it('should not cancel snippet if position in range', async () => {
      let session = await createSession()
      await session.start('${1:foo}', defaultRange)
      await nvim.call('cursor', [1, 3])
      await session.checkPosition()
      expect(session.isActive).toBe(true)
    })
  })

  describe('resolveSnippet()', () => {
    it('should resolveSnippet', async () => {
      let session = await createSession()
      let res = await session.resolveSnippet(nvim, '${1:`!p snip.rv = "foo"`}', { line: 'foo', range: Range.create(0, 0, 0, 3) })
      expect(res).toBe('foo')
    })
  })

  describe('selectPlaceholder()', () => {
    it('should select range placeholder', async () => {
      let session = await createSession()
      await session.start('${1:abc}', defaultRange)
      let mode = await nvim.mode
      expect(mode.mode).toBe('s')
      await nvim.input('<backspace>')
      let line = await nvim.line
      expect(line).toBe('')
    })

    it('should select empty placeholder', async () => {
      let session = await createSession()
      await session.start('a ${1} ${2}', defaultRange)
      let mode = await nvim.mode
      expect(mode.mode).toBe('i')
      let col = await nvim.call('col', '.')
      expect(col).toBe(3)
    })

    it('should select choice placeholder', async () => {
      await nvim.input('i')
      let session = await createSession()
      await session.start('${1|one,two,three|}', defaultRange)
      let line = await nvim.line
      expect(line).toBe('one')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.length).toBe(3)
    })
  })
})
