import { Neovim } from '@chemzqm/neovim'
import * as assert from 'assert'
import path from 'path'
import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver-protocol'
import { Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import events from '../../events'
import { addPythonTryCatch, executePythonCode, generateContextId, getInitialPythonCode, getVariablesCode, hasPython } from '../../snippets/eval'
import { CodeBlock, Placeholder, SnippetParser, Text, TextmateSnippet } from '../../snippets/parser'
import { CocSnippet, getNextPlaceholder, getUltiSnipActionCodes } from '../../snippets/snippet'
import { SnippetString } from '../../snippets/string'
import { convertRegex, getTextAfter, getTextBefore, normalizeSnippetString, shouldFormat, toSnippetString, UltiSnippetContext } from '../../snippets/util'
import { padZero, parseComments, parseCommentstring, SnippetVariableResolver } from '../../snippets/variableResolve'
import { UltiSnippetOption } from '../../types'
import { getEnd } from '../../util/position'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  let pyfile = path.join(__dirname, '../ultisnips.py')
  await nvim.command(`execute 'pyxfile '.fnameescape('${pyfile}')`)
})

afterAll(async () => {
  await helper.shutdown()
})

async function createSnippet(snippet: string | TextmateSnippet, opts?: UltiSnippetOption, range = Range.create(0, 0, 0, 0), line = '') {
  let resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
  let snip = new CocSnippet(snippet, Position.create(0, 0), nvim, resolver)
  let context: UltiSnippetContext
  if (opts) {
    context = { range, line, ...opts, id: generateContextId(workspace.bufnr) }
    await executePythonCode(nvim, getInitialPythonCode(context))
  }
  await snip.init(context)
  return snip
}

describe('SnippetString', () => {
  it('should check SnippetString', () => {
    assert.strictEqual(SnippetString.isSnippetString(null), false)
    let snippetString = new SnippetString()
    assert.strictEqual(SnippetString.isSnippetString(snippetString), true)
    assert.strictEqual(SnippetString.isSnippetString({}), false)
  })

  it('should build snippet string', () => {
    let snippetString: SnippetString

    snippetString = new SnippetString()
    assert.strictEqual(snippetString.appendText('I need $ and $').value, 'I need \\$ and \\$')

    snippetString = new SnippetString()
    assert.strictEqual(snippetString.appendText('I need \\$').value, 'I need \\\\\\$')

    snippetString = new SnippetString()
    snippetString.appendPlaceholder('fo$o}')
    assert.strictEqual(snippetString.value, '${1:fo\\$o\\}}')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendTabstop(0).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo$0bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendTabstop().appendText('bar')
    assert.strictEqual(snippetString.value, 'foo$1bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendTabstop(42).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo$42bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendPlaceholder('farboo').appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1:farboo}bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendPlaceholder('far$boo').appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1:far\\$boo}bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendPlaceholder(b => b.appendText('abc').appendPlaceholder('nested')).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1:abc${2:nested}}bar')

    snippetString = new SnippetString()
    snippetString.appendVariable('foo', 'foo')
    assert.strictEqual(snippetString.value, '${foo:foo}')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendVariable('TM_SELECTED_TEXT').appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${TM_SELECTED_TEXT}bar')

    snippetString = new SnippetString()
    snippetString.appendVariable('BAR', b => b.appendPlaceholder('ops'))
    assert.strictEqual(snippetString.value, '${BAR:${1:ops}}')

    snippetString = new SnippetString()
    snippetString.appendVariable('BAR', b => {})
    assert.strictEqual(snippetString.value, '${BAR}')

    snippetString = new SnippetString()
    snippetString.appendChoice(['b', 'a', 'r'])
    assert.strictEqual(snippetString.value, '${1|b,a,r|}')

    snippetString = new SnippetString()
    snippetString.appendChoice(['b,1', 'a,2', 'r,3'])
    assert.strictEqual(snippetString.value, '${1|b\\,1,a\\,2,r\\,3|}')

    snippetString = new SnippetString()
    snippetString.appendChoice(['b', 'a', 'r'], 0)
    assert.strictEqual(snippetString.value, '${0|b,a,r|}')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendChoice(['far', 'boo']).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1|far,boo|}bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendChoice(['far', '$boo']).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1|far,$boo|}bar')

    snippetString = new SnippetString()
    snippetString.appendText('foo').appendPlaceholder('farboo').appendChoice(['far', 'boo']).appendText('bar')
    assert.strictEqual(snippetString.value, 'foo${1:farboo}${2|far,boo|}bar')
  })

  it('should escape/apply snippet choices correctly', () => {
    {
      const s = new SnippetString()
      s.appendChoice(["aaa$aaa"])
      s.appendText("bbb$bbb")
      assert.strictEqual(s.value, '${1|aaa$aaa|}bbb\\$bbb')
    }
    {
      const s = new SnippetString()
      s.appendChoice(["aaa,aaa"])
      s.appendText("bbb$bbb")
      assert.strictEqual(s.value, '${1|aaa\\,aaa|}bbb\\$bbb')
    }
    {
      const s = new SnippetString()
      s.appendChoice(["aaa|aaa"])
      s.appendText("bbb$bbb")
      assert.strictEqual(s.value, '${1|aaa\\|aaa|}bbb\\$bbb')
    }
    {
      const s = new SnippetString()
      s.appendChoice(["aaa\\aaa"])
      s.appendText("bbb$bbb")
      assert.strictEqual(s.value, '${1|aaa\\\\aaa|}bbb\\$bbb')
    }
  })
})

describe('toSnippetString()', () => {
  it('should convert snippet to string', async () => {
    assert.throws(() => {
      toSnippetString(1 as any)
    }, TypeError)
    assert.strictEqual(toSnippetString(new SnippetString()), '')
  })
})

describe('CocSnippet', () => {
  async function assertResult(snip: string, resolved: string, opts?: UltiSnippetOption) {
    let c = await createSnippet(snip, opts)
    assert.strictEqual(c.text, resolved)
  }

  async function assertPyxValue(code: string, res: any) {
    let val = await nvim.call(`pyxeval`, code) as string
    if (typeof res === 'number' || typeof res === 'string' || typeof res === 'boolean') {
      assert.strictEqual(val, res)
    } else if (res instanceof RegExp) {
      assert.match(val, res)
    } else {
      assert.deepStrictEqual(val, res)
    }
  }

  describe('resolveVariables()', () => {
    it('should padZero', () => {
      assert.strictEqual(padZero(1), '01')
      assert.strictEqual(padZero(10), '10')
    })

    it('should getVariablesCode', () => {
      assert.strictEqual(getVariablesCode({}), 't = ()')
      assert.strictEqual(getVariablesCode({ 1: 'foo', 3: 'bar' }), 't = ("","foo","","bar",)')
    })

    it('should resolve uppercase variables', async () => {
      let doc = await helper.createDocument()
      let fsPath = URI.parse(doc.uri).fsPath
      await assertResult('$TM_FILENAME', path.basename(fsPath))
      await assertResult('$TM_FILENAME_BASE', path.basename(fsPath, path.extname(fsPath)))
      await assertResult('$TM_DIRECTORY', path.dirname(fsPath))
      await assertResult('$TM_FILEPATH', fsPath)
      await nvim.call('setreg', ['""', 'foo'])
      await assertResult('$YANK', 'foo')
      await assertResult('$TM_LINE_INDEX', '0')
      await assertResult('$TM_LINE_NUMBER', '1')
      await nvim.setLine('foo')
      await assertResult('$TM_CURRENT_LINE', 'foo')
      await nvim.call('setreg', ['*', 'foo'])
      await assertResult('$CLIPBOARD', 'foo')
      let d = new Date()
      await assertResult('$CURRENT_YEAR', d.getFullYear().toString())
      await assertResult('$NOT_EXISTS', 'NOT_EXISTS')
      await assertResult('$TM_CURRENT_WORD', 'foo')
    })

    it('should resolve new VSCode variables', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.setOption('comments', 's1:/*,mb:*,ex:*/,://,b:#,:%,:XCOMM,n:>,fb:-')
      await doc.buffer.setOption('commentstring', '')
      let fsPath = URI.parse(doc.uri).fsPath
      let c = await createSnippet('$RANDOM')
      assert.strictEqual(c.text.length, 6)
      c = await createSnippet('$RANDOM_HEX')
      assert.strictEqual(c.text.length, 6)
      c = await createSnippet('$UUID')
      assert.ok((c.text).includes('-'))
      c = await createSnippet('$RELATIVE_FILEPATH')
      assert.ok((c.text).includes(path.basename(fsPath)))
      c = await createSnippet('$WORKSPACE_NAME')
      assert.ok((c.text.length) > (0))
      c = await createSnippet('$WORKSPACE_FOLDER')
      assert.ok((c.text.length) > (0))
      await assertResult('$LINE_COMMENT', '//')
      await assertResult('$BLOCK_COMMENT_START', '/*')
      await assertResult('$BLOCK_COMMENT_END', '*/')
      await doc.buffer.setOption('comments', '')
      await doc.buffer.setOption('commentstring', '// %s')
      await assertResult('$LINE_COMMENT', '//')
      await assertResult('$BLOCK_COMMENT_START', '')
      await assertResult('$BLOCK_COMMENT_END', '')
    })

    it('should resolve variables in placeholders', async () => {
      await nvim.setLine('foo')
      await assertResult('$1 ${1:$TM_CURRENT_LINE}', 'foo foo')
      await assertResult('$1 ${1:$TM_CURRENT_LINE bar}', 'foo bar foo bar')
      await assertResult('$2 ${2:|${1:$TM_CURRENT_LINE}|}', '|foo| |foo|')
      await assertResult('$1 $2 ${2:${1:|$TM_CURRENT_LINE|}}', '|foo| |foo| |foo|')
    })

    it('should resolve variables  with default value', async () => {
      await assertResult('$1 ${1:${VISUAL:foo}}', 'foo foo')
    })

    it('should resolve for lower case variables', async () => {
      await assertResult('${foo:abcdef} ${bar}', 'abcdef bar')
      await assertResult('${1:${foo:abcdef}} ${1/^\\w\\w(.*)/$1/}', 'abcdef cdef')
    })
  })

  describe('getUltiSnipOption', () => {
    it('should get snippets option', async () => {
      let c = await createSnippet('${1:foo}', { noExpand: true })
      let m = c.tmSnippet.children[0]
      assert.strictEqual(c.getUltiSnipOption(m, 'noExpand'), true)
      assert.strictEqual(c.getUltiSnipOption(c.tmSnippet, 'noExpand'), true)
      assert.strictEqual(c.getUltiSnipOption(new Text(''), 'trimTrailingWhitespace'), undefined)
    })
  })

  describe('findParent()', () => {
    it('should throw when not found', async () => {
      let snip = new TextmateSnippet()
      snip.appendChild(new Text('f'))
      let c = await createSnippet(snip)
      assert.throws(() => {
        c.findParent(Range.create(1, 0, 1, 0))
      }, Error)
    })

    it('should not use adjacent choice placeholder', async () => {
      let c = await createSnippet('a\n${1|one,two,three|}\nb')
      let res = c.findParent(Range.create(1, 0, 1, 0))
      assert.strictEqual(res.marker instanceof TextmateSnippet, true)
    })
  })

  describe('replaceWithText()', () => {
    it('should not return undefined when no change', async () => {
      let c = await createSnippet('${1:foo}')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 0), '', token)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.snippetText, 'foo')
    })

    it('should replace with Text for choice placeholder', async () => {
      let c = await createSnippet(' ${1|one,two,three|} ')
      let res = c.replaceWithMarker(Range.create(0, 2, 0, 4), new Text('bar'))
      assert.strictEqual(res.children.length, 1)
      assert.strictEqual(res.children[0].toString(), 'obar')
    })

    it('should not insert line break at the start of placeholder', async () => {
      let c = await createSnippet(' ${1:bar} ')
      let p = c.getPlaceholderByIndex(1).marker
      let res = c.replaceWithMarker(Range.create(0, 1, 0, 1), new Text('\n'), p)
      let text = c.tmSnippet.children[0] as Text
      assert.strictEqual(text.value, ' \n')
      assert.strictEqual(res.toString(), 'bar')
    })

    it('should return undefined when cursor not changed', async () => {
      let doc = await workspace.document
      let c = await createSnippet('${1:foo}')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 3), '', token, undefined, doc.cursor)
      assert.strictEqual(res.delta, undefined)
    })

    it('should synchronize without related change', async () => {
      const assertChange = async (range: Range, newText: string, resultText: string) => {
        let token = (new CancellationTokenSource()).token
        let c = await createSnippet('begin ${1:foo} end')
        await c.replaceWithText(range, newText, token)
        assert.strictEqual(c.text, resultText)
        let start = Position.create(0, 0)
        let end = getEnd(start, resultText)
        assert.deepStrictEqual(c.range, Range.create(start, end))
        return c
      }
      // insert text
      await assertChange(Range.create(0, 0, 0, 0), 'aa ', 'aa begin foo end')
      // insert placeholder
      let snippet = await assertChange(Range.create(0, 6, 0, 6), 'xx', 'begin xxfoo end')
      let p = snippet.getPlaceholderByIndex(1)
      assert.strictEqual(p.value, 'xxfoo')
      // delete text of placeholder
      snippet = await assertChange(Range.create(0, 6, 0, 9), '', 'begin  end')
      p = snippet.getPlaceholderByIndex(1)
      assert.strictEqual(p.value, '')
      // delete text
      await assertChange(Range.create(0, 0, 0, 6), '', 'foo end')
      //  delete Text and Placeholder
      snippet = await assertChange(Range.create(0, 0, 0, 8), '', 'o end')
      p = snippet.getPlaceholderByIndex(1)
      assert.strictEqual(p, undefined)
      let marker = snippet.getPlaceholderById(0.5, 0)
      assert.notStrictEqual(marker, undefined)
      marker = snippet.getPlaceholderById(10, 9)
      assert.strictEqual(marker, undefined)
    })

    it('should prefer current placeholder', async () => {
      let m: Placeholder
      let c = await createSnippet('b ${1:${2:bar} foo} x')
      let marker = c.getPlaceholderByIndex(1).marker
      // use outer
      m = c.replaceWithMarker(Range.create(0, 2, 0, 3), new Text('insert'), marker) as Placeholder
      assert.strictEqual(m, marker)
      assert.strictEqual(m.children.length, 1)
      assert.strictEqual(m.children[0].toString(), 'insertar foo')
      // use inner
      c = await createSnippet('b ${1:${2:bar} foo} x')
      m = c.replaceWithMarker(Range.create(0, 2, 0, 3), new Text('insert')) as Placeholder
      assert.strictEqual(m instanceof Placeholder, true)
      assert.strictEqual(m.index, 2)
      assert.strictEqual(m.children.length, 1)
      assert.strictEqual(m.children[0].toString(), 'insertar')
    })

    it('should insert with marker', async () => {
      let c; let m
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 0, 0, 0), new Text('before'))
      assert.strictEqual(m.toString(), 'beforefoo')
      assert.strictEqual(m.children.length, 1)
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 1, 0, 1), new Text('before'))
      assert.strictEqual(m.toString(), 'fbeforeoo')
      assert.strictEqual(m.children.length, 1)
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 3, 0, 3), new Text('before'))
      assert.strictEqual(m.toString(), 'foobefore')
      assert.strictEqual(m.children.length, 1)
    })

    it('should insert inside text', async () => {
      let c = await createSnippet('foo ${1:bar}')
      let marker = (new SnippetParser()).parse('${1:a}', true)
      let res = c.replaceWithMarker(Range.create(0, 1, 0, 2), marker)
      assert.strictEqual(res, c.tmSnippet)
      assert.strictEqual(c.tmSnippet.toString(), 'fao bar')
    })

    it('should change final placeholder', async () => {
      let c = await createSnippet('${1:foo} ${0:bar}')
      let changed = c.replaceWithMarker(Range.create(0, 4, 0, 4), new Text(' '))
      assert.strictEqual(changed.toString(), 'foo  bar')
      c.synchronize()
      changed = c.replaceWithMarker(Range.create(0, 5, 0, 6), new Text(''))
      assert.strictEqual(changed['index'], 0)
      assert.strictEqual(changed.toString(), 'ar')
    })

    it('should replace with Text when placeholder is not primary', async () => {
      let c = await createSnippet('$1 ${1:foo}')
      let result = await c.replaceWithText(Range.create(0, 0, 0, 1), 'b', CancellationToken.None)
      assert.strictEqual(result.marker instanceof Text, true)
      assert.strictEqual(result.snippetText, 'boo foo')
    })
  })

  describe('replaceWithSnippet()', () => {
    it('should insert nested placeholder', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      c.deactivateSnippet(undefined)
      // assert.strictEqual(c.getUltiSnipActionCodes(undefined, 'postJump'), undefined)
      let res = await c.replaceWithSnippet(Range.create(0, 0, 0, 3), '${1:bar}')
      assert.strictEqual(res.toString(), 'bar')
      assert.strictEqual(res.parent.snippet.toString(), 'bar\nbar')
      assert.strictEqual(c.text, 'bar\nbar')
    })

    it('should insert python snippet to normal snippet', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      let p = c.getPlaceholderByIndex(1)
      assert.strictEqual(c.hasPython, false)
      let res = await c.replaceWithSnippet(p.range, '${1:x} `!p snip.rv = t[1]`', p.marker, { line: '', range: p.range, id: `1-1` })
      assert.strictEqual(res.toString(), 'x x')
      assert.strictEqual(c.text, 'x x\nx x')
      let r = c.getPlaceholderByMarker(res.first)
      let source = new CancellationTokenSource()
      let result = await c.replaceWithText(r.range, 'bar', source.token)
      assert.strictEqual(result.snippetText, 'bar x\nx x')
      assert.strictEqual(c.text, 'bar bar\nbar bar')
      assert.strictEqual(c.hasPython, true)
    })

    it('should not change match for original placeholders', async () => {
      let c = await createSnippet('`!p snip.rv = match.group(1)` $1', {
        regex: '^(\\w+)'
      }, Range.create(0, 0, 0, 3), 'foo')
      let p = c.getPlaceholderByIndex(1)
      assert.strictEqual(c.hasPython, true)
      assert.strictEqual(c.text, 'foo ')
      let context = {
        id: `1-1`,
        regex: '^(\\w+)',
        line: 'bar',
        range: Range.create(0, 0, 0, 3)
      }
      await executePythonCode(nvim, getInitialPythonCode(context))
      await c.replaceWithSnippet(p.range, '`!p snip.rv = match.group(1)`', p.marker, context)
      assert.strictEqual(c.text, 'foo bar')
    })

    it('should update with independent python global', async () => {
      let c = await createSnippet('${1:foo} `!p snip.rv = t[1]`', {})
      let range = Range.create(0, 0, 0, 3)
      let line = await nvim.line
      await c.replaceWithSnippet(range, '${1:bar} `!p snip.rv = t[1]`', undefined, { range, line, id: `1-1` })
      assert.strictEqual(c.text, 'bar bar bar bar')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 3), 'xy', token)
      assert.strictEqual(c.text, 'xy xy xy xy')
      assert.strictEqual(res.delta, undefined)
    })

    it('should not throw when parent not exist', async () => {
      let c = await createSnippet('${1:foo}', {})
      await c.onMarkerUpdate(new Placeholder(1), CancellationToken.None)
    })

    it('should not synchronize with none primary placeholder change', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      let res = await c.replaceWithSnippet(Range.create(1, 0, 1, 3), '${1:bar}')
      assert.strictEqual(res.toString(), 'bar')
      assert.strictEqual(c.tmSnippet.toString(), 'foo\nbar')
    })
  })

  describe('getMarkerPosition', () => {
    it('should get position of marker', async () => {
      let c = await createSnippet('${1:foo}')
      assert.strictEqual(c.getMarkerPosition(new Placeholder(1)), undefined)
      let cloned = c.tmSnippet.clone()
      assert.strictEqual(c.getMarkerPosition(cloned), undefined)
      assert.notStrictEqual(c.getMarkerPosition(c.tmSnippet), undefined)
    })
  })

  describe('code block initialize', () => {
    it('should init shell code block', async () => {
      await assertResult('`echo "hello"` world', 'hello world', {})
    })

    it('should init vim block', async () => {
      await assertResult('`!v eval("1 + 1")` = 2', '2 = 2', {})
      await nvim.setLine('  ')
      await assertResult('${1:`!v indent(".")`} "$1"', '2 "2"', {})
    })

    it('should init code block in placeholders', async () => {
      await assertResult('f ${1:`echo "b"`}', 'f b', {})
      await assertResult('f ${1:`!v "b"`}', 'f b', {})
      await assertResult('f ${1:`!p snip.rv = "b"`}', 'f b', {})
    })

    it('should setup python globals', async () => {
      await helper.edit('t.js')
      await createSnippet('`!p snip.rv = fn`', {})
      await assertPyxValue('fn', 't.js')
      await assertPyxValue('path', /t\.js$/)
      await assertPyxValue('t', [''])
      await createSnippet('`!p snip.rv = fn`', {
        regex: '[ab]',
        context: 'False'
      }, Range.create(0, 2, 0, 3), 'a b')
      await assertPyxValue('match.group(0)', 'b')
    })

    it('should setup python match', async () => {
      let c = await createSnippet('\\\\frac{`!p snip.rv = match.group(1)`}{$1}$0', {
        regex: '((\\d+)|(\\d*)(\\\\)?([A-Za-z]+)((\\^|_)(\\{\\d+\\}|\\d))*)/',
        context: 'True'
      }, Range.create(0, 0, 0, 3), '20/')
      await assertPyxValue('match.group(1)', '20')
      assert.strictEqual(c.text, '\\frac{20}{}')
    })

    it('should work with methods of snip', async () => {
      await nvim.command('setl shiftwidth=4 ft=txt tabstop=4 expandtab')
      await createSnippet('`!p snip.rv = "a"`', {}, Range.create(0, 4, 0, 8), '    abcd')
      await executePythonCode(nvim, [])
      await executePythonCode(nvim, [
        'snip.shift(1)',
        // ultisnip indent only when there's '\n' in snip.rv
        'snip += ""',
        'newLine = snip.mkline("foo")'
      ])
      await assertPyxValue('newLine', '        foo')
      await executePythonCode(nvim, [
        'snip.unshift(1)',
        'newLine = snip.mkline("b")'
      ])
      await assertPyxValue('newLine', '    b')
      await executePythonCode(nvim, [
        'snip.shift(1)',
        'snip.reset_indent()',
        'newLine = snip.mkline("f")'
      ])
      await assertPyxValue('newLine', '    f')
      await executePythonCode(nvim, [
        'fff = snip.opt("&fff", "foo")',
        'ft = snip.opt("&ft", "ft")',
      ])
      await assertPyxValue('fff', 'foo')
      await assertPyxValue('ft', 'txt')
    })

    it('should init python code block', async () => {
      await assertResult('`!p snip.rv = "a"` = a', 'a = a', {})
      await assertResult('`!p snip.rv = t[1]` = ${1:a}', 'a = a', {})
      await assertResult('`!p snip.rv = t[1]` = ${1:`!v eval("\'a\'")`}', 'a = a', {})
      await assertResult('`!p snip.rv = t[1] + t[2]` = ${1:a} ${2:b}', 'ab = a b', {})
    })

    it('should init python placeholder', async () => {
      await assertResult('foo ${1/^\\|(.*)\\|$/$1/} ${1:|`!p snip.rv = "a"`|}', 'foo a |a|', {})
      await assertResult('foo $1 ${1:`!p snip.rv = "a"`}', 'foo a a', {})
      await assertResult('${1/^_(.*)/$1/} $1 aa ${1:`!p snip.rv = "_foo"`}', 'foo _foo aa _foo', {})
    })

    it('should init nested python placeholder', async () => {
      await assertResult('${1:foo`!p snip.rv = t[2]`} ${2:bar} $1', 'foobar bar foobar', {})
      await assertResult('${3:f${2:oo${1:b`!p snip.rv = "ar"`}}} `!p snip.rv = t[3]`', 'foobar foobar', {})
    })

    it('should recursive init python placeholder', async () => {
      await assertResult('${1:`!p snip.rv = t[2]`} ${2:`!p snip.rv = t[3]`} ${3:`!p snip.rv = t[4][0]`} ${4:bar}', 'b b b bar', {})
      await assertResult('${1:foo} ${2:`!p snip.rv = t[1][0]`} ${3:`!p snip.rv = ""`} ${4:`!p snip.rv = t[2]`}', 'foo f  f', {})
    })

    it('should update python block from placeholder', async () => {
      await assertResult('`!p snip.rv = t[1][0] if len(t[1]) > 0 else ""` ${1:`!p snip.rv = t[2]`} ${2:foo}', 'f foo foo', {})
    })
  })

  describe('updatePlaceholder()', () => {
    async function assertUpdate(text: string, value: string, result: string, index = 1, ultisnip: UltiSnippetOption | null = {}): Promise<CocSnippet> {
      let c = await createSnippet(text, ultisnip)
      let p = c.getPlaceholderByIndex(index)
      assert.strictEqual(p != null, true)
      p.marker.setOnlyChild(new Text(value))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.None)
      assert.strictEqual(c.tmSnippet.toString(), result)
      return c
    }

    it('should update variable placeholders', async () => {
      await assertUpdate('${foo} ${foo}', 'bar', 'bar bar', 1, null)
      await assertUpdate('${1:${foo:x}} $1', 'bar', 'bar bar', 1, null)
    })

    it('should not update when cancelled', async () => {
      let c = await createSnippet('${1:foo} `!p snip.rv = t[1]`', {})
      let p = c.getPlaceholderByIndex(1)
      assert.strictEqual(p != null, true)
      p.marker.setOnlyChild(new Text('bar'))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.Cancelled)
      assert.strictEqual(c.tmSnippet.toString(), 'bar foo')
    })

    it('should work with snip.c', async () => {
      let code = [
        '#ifndef ${1:`!p',
        'if not snip.c:',
        '  import random, string',
        "  name = re.sub(r'[^A-Za-z0-9]+','_', snip.fn).upper()",
        "  rand = ''.join(random.sample(string.ascii_letters+string.digits, 8))",
        "  snip.rv = ('%s_%s' % (name,rand)).upper()",
        "else:",
        "  snip.rv = snip.c + t[2]`}",
        '#define $1',
        '$2'
      ].join('\n')
      let c = await createSnippet(code, {})
      let first = c.text.split('\n')[0]
      let p = c.getPlaceholderByIndex(2)
      assert.notStrictEqual(p, undefined)
      p.marker.setOnlyChild(new Text('foo'))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.None)
      let t = c.tmSnippet.toString()
      assert.strictEqual(t.startsWith(first), true)
      assert.deepStrictEqual(t.split('\n').map(s => s.endsWith('foo')), [true, true, true])
    })

    it('should update placeholder with code blocks', async () => {
      await assertUpdate('${1:`echo "foo"`} $1', 'bar', 'bar bar')
      await assertUpdate('${2:${1:`echo "foo"`}} $2', 'bar', 'bar bar')
      await assertUpdate('${1:`!v "foo"`} $1', 'bar', 'bar bar')
      await assertUpdate('${1:`!p snip.rv = "foo"`} $1', 'bar', 'bar bar')
    })

    it('should update related python blocks', async () => {
      // multiple
      await assertUpdate('`!p snip.rv = t[1]` ${1:`!p snip.rv = "foo"`} `!p snip.rv = t[1]`', 'bar', 'bar bar bar')
      // parent
      await assertUpdate('`!p snip.rv = t[2]` ${2:foo ${1:`!p snip.rv = "foo"`}}', 'bar', 'foo bar foo bar')
      // related placeholders
      await assertUpdate('${2:foo `!p snip.rv = t[1]`} ${1:`!p snip.rv = "foo"`}', 'bar', 'foo bar bar')
    })

    it('should update python code blocks with normal placeholder values', async () => {
      await assertUpdate('`!p snip.rv = t[1]` $1 `!p snip.rv = t[1]`', 'bar', 'bar bar bar')
      await assertUpdate('`!p snip.rv = t[2]` ${2:foo $1}', 'bar', 'foo bar foo bar')
      await assertUpdate('${2:foo `!p snip.rv = t[1]`} $1', 'bar', 'foo bar bar')
    })

    it('should reset values for removed placeholders', async () => {
      // Keep remained placeholder this is same behavior of VSCode.
      let s = await assertUpdate('${2:bar${1:foo}} $2 $1', 'bar', 'bar bar foo', 2)
      let p = s.getPlaceholderByIndex(2).marker
      let marker = getNextPlaceholder(p, false)
      let prev = s.getPlaceholderByMarker(marker)
      assert.notStrictEqual(prev, undefined)
      assert.strictEqual(prev.value, 'foo')
      // python placeholder, reset to empty value
      await assertUpdate('${2:bar${1:foo}} $2 `!p snip.rv = t[1]`', 'bar', 'bar bar ', 2)
      // not reset since $1 still exists
      await assertUpdate('${2:bar${1:foo}} $2 $1 `!p snip.rv = t[1]`', 'bar', 'bar bar foo foo', 2)
    })
  })

  describe('getNextPlaceholder()', () => {
    it('should get next placeholder', async () => {
      let c = await createSnippet('${1:a} ${2:b}')
      let p = c.getPlaceholderByIndex(1)
      let nested = await c.replaceWithSnippet(p.range, '${1:foo} ${2:bar}')
      nested.placeholders.forEach(p => {
        p.primary = false
      })
      let snip = c.snippets[1]
      assert.strictEqual(c.snippets[1], nested)
      let marker = snip.first
      let next = getNextPlaceholder(marker, true)
      assert.strictEqual(next.index, 2)
      assert.strictEqual(next.toString(), 'bar')
      {
        let m = nested.placeholders.find(o => o.index === 0)
        let next = getNextPlaceholder(m, false)
        assert.strictEqual(next.toString(), 'foo bar')
      }
    })

    it('should not throw when next not exists', async () => {
      assert.strictEqual(getNextPlaceholder(new Placeholder(1), true), undefined)
      assert.strictEqual(getNextPlaceholder(undefined, true), undefined)
    })
    it('should not throw when next not exists', async () => {
      assert.strictEqual(getNextPlaceholder(new Placeholder(1), true), undefined)
      assert.strictEqual(getNextPlaceholder(undefined, true), undefined)
    })

    it('should prefer primary placeholder', async () => {
      let c = await createSnippet('$1 $2 ${1:foo}')
      let p = c.getPlaceholderByIndex(2)
      let next = getNextPlaceholder(p.marker, false)
      assert.strictEqual(next.index, 1)
      assert.strictEqual(next.primary, true)
    })
  })

  describe('getUltiSnipActionCodes()', () => {
    it('should not get codes when action not exists', () => {
      assert.strictEqual(getUltiSnipActionCodes(undefined, 'postJump'), undefined)
      assert.strictEqual(getUltiSnipActionCodes(new Text(''), 'postJump'), undefined)
      let snip = (new SnippetParser()).parse('${1:a}', true)
      assert.strictEqual(getUltiSnipActionCodes(snip, 'postJump'), undefined)
    })

    it('should get codes when exists action', async () => {
      let snip = (new SnippetParser()).parse('${1:a}', true)
      snip.related.context = {
        id: `1-1`,
        line: '',
        range: Range.create(0, 0, 0, 0),
        actions: { postJump: 'jump' }
      }
      let res = getUltiSnipActionCodes(snip, 'postJump')
      assert.strictEqual(res.length, 2)
    })
  })

  describe('getRanges getSnippetPlaceholders getTabStops', () => {
    it('should get ranges of placeholder', async () => {
      let c = await createSnippet('${2:${1:x} $1}\n$2', {})
      let p = c.getPlaceholderByIndex(1)
      let arr = c.getRanges(p.marker)
      assert.strictEqual(arr.length, 2)
      assert.deepStrictEqual(arr[0], Range.create(0, 0, 0, 1))
      assert.deepStrictEqual(arr[1], Range.create(0, 2, 0, 3))
      assert.strictEqual(c.text, 'x x\nx x')
    })

    it('should get range of marker snippet', async () => {
      let c = await createSnippet('${1:foo}', {})
      let p = new Placeholder(1)
      assert.strictEqual(c.getSnippetRange(p), undefined)
      let snip = (new SnippetParser()).parse('${1:a}', true)
      assert.strictEqual(c.getSnippetRange(snip.children[0]), undefined)
      let range = c.getSnippetRange(c.tmSnippet.children[0])
      assert.deepStrictEqual(range, Range.create(0, 0, 0, 3))
    })

    it('should get snippet tabstops', async () => {
      let c = await createSnippet('${1:foo}', {})
      let p = new Placeholder(1)
      assert.deepStrictEqual(c.getSnippetTabstops(p), [])
      let tabstops = c.getSnippetTabstops(c.tmSnippet.children[0])
      assert.strictEqual(tabstops.length, 2)
    })
  })

  describe('utils', () => {
    function assertThrow(fn: () => void) {
      let err
      try {
        fn()
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    }

    it('should getTextBefore', () => {
      function assertText(r: number[], text: string, pos: [number, number], res: string): void {
        let t = getTextBefore(Range.create(r[0], r[1], r[2], r[3]), text, Position.create(pos[0], pos[1]))
        assert.strictEqual(t, res)
      }
      assertText([1, 1, 2, 1], 'abc\nd', [1, 1], '')
      assertText([1, 1, 2, 1], 'abc\nd', [2, 1], 'abc\nd')
      assertText([1, 1, 3, 1], 'abc\n\nd ', [3, 1], 'abc\n\nd')
    })

    it('should getTextAfter', () => {
      function assertText(r: number[], text: string, pos: [number, number], res: string): void {
        let t = getTextAfter(Range.create(r[0], r[1], r[2], r[3]), text, Position.create(pos[0], pos[1]))
        assert.strictEqual(t, res)
      }
      assertText([1, 1, 2, 1], 'abc\nd', [1, 1], 'abc\nd')
      assertText([1, 1, 2, 1], 'abc\nd', [2, 1], '')
      assertText([1, 1, 3, 1], 'abc\n\nd', [2, 0], '\nd')
      assertText([0, 0, 0, 3], 'abc', [0, 3], '')
    })

    it('should check shouldFormat', () => {
      assert.strictEqual(shouldFormat(' f'), true)
      assert.strictEqual(shouldFormat('a\nb'), true)
      assert.strictEqual(shouldFormat('foo'), false)
    })

    it('should normalizeSnippetString', () => {
      assert.strictEqual(normalizeSnippetString('a\n\n\tb', '  ', {
        insertSpaces: true,
        trimTrailingWhitespace: true,
        tabSize: 2
      }), 'a\n\n    b')
      assert.strictEqual(normalizeSnippetString('a\n\n  b', '\t', {
        insertSpaces: false,
        trimTrailingWhitespace: true,
        tabSize: 2
      }), 'a\n\n\t\tb')
      let res = normalizeSnippetString('a\n\n\tb', '\t', {
        insertSpaces: false,
        trimTrailingWhitespace: false,
        noExpand: true,
        tabSize: 2
      })
      assert.strictEqual(res, 'a\n\t\n\t\tb')
    })

    it('should throw for invalid regex', async () => {
      assertThrow(() => {
        convertRegex('\\z')
      })
      assertThrow(() => {
        convertRegex('(?s)')
      })
      assertThrow(() => {
        convertRegex('(?x)')
      })
      assertThrow(() => {
        convertRegex('a\nb')
      })
      assertThrow(() => {
        convertRegex('(<)?(\\w+@\\w+(?:\\.\\w+)+)(?(1)>|$)')
      })
      assertThrow(() => {
        convertRegex('(<)?(\\w+@\\w+(?:\\.\\w+)+)(?(1)>|)')
      })
    })

    it('should convert regex', async () => {
      // \\A
      assert.strictEqual(convertRegex('\\A'), '^')
      assert.strictEqual(convertRegex('f(?#abc)b'), 'fb')
      assert.strictEqual(convertRegex('f(?P<abc>def)b'), 'f(?<abc>def)b')
      assert.strictEqual(convertRegex('f(?P=abc)b'), 'f\\k<abc>b')
    })

    it('should catch error with executePythonCode', async () => {
      let fn = async () => {
        await executePythonCode(nvim, ['INVALID_CODE'])
      }
      await assert.rejects(fn(), Error)
    })

    it('should set error with addPythonTryCatch', async () => {
      let code = addPythonTryCatch('INVALID_CODE', true)
      await nvim.command(`pyx ${code}`)
      let msg = await nvim.getVar('errmsg')
      assert.notStrictEqual(msg, undefined)
      assert.ok(typeof msg === 'string' && msg.includes('INVALID_CODE'))
    })

    it('should cancel code block eval when necessary', async (): Promise<void> => {
      {
        let block = new CodeBlock('echo "foo"', 'shell')
        await block.resolve(nvim, CancellationToken.Cancelled)
        assert.strictEqual(block.len(), 0)
      }
      {
        let block = new CodeBlock('bufnr("%")', 'vim')
        await block.resolve(nvim, CancellationToken.None)
        let bufnr = await nvim.eval('bufnr("%")')
        assert.strictEqual(block.value, `${bufnr}`)
      }
      {
        let block = new CodeBlock('v:null', 'vim')
        await block.resolve(nvim)
        assert.strictEqual(block.value, '')
      }
      {
        await executePythonCode(nvim, [`snip = SnippetUtil("", (0, 0), (0, 0), None)`])
        let block = new CodeBlock('snip.rv = "foo"', 'python')
        let tokenSource = new CancellationTokenSource()
        let token = tokenSource.token
        process.nextTick(() => {
          tokenSource.cancel()
        })
        await block.resolve(nvim, token)
      }
    })

    it('should parse comments', async () => {
      assert.strictEqual(parseCommentstring('a%sb'), undefined)
      assert.strictEqual(parseCommentstring('// %s'), '//')
      assert.deepStrictEqual(parseComments(''), {
        start: undefined,
        end: undefined,
        single: undefined
      })
      assert.deepStrictEqual(parseComments('s:/*'), {
        start: '/*',
        end: undefined,
        single: undefined
      })
      assert.deepStrictEqual(parseComments('e:*/'), {
        end: '*/',
        start: undefined,
        single: undefined
      })
      assert.deepStrictEqual(parseComments(':#,:b'), {
        end: undefined,
        start: undefined,
        single: '#'
      })
    })

    it('should set request variable', async () => {
      events.requesting = true
      await executePythonCode(nvim, ['stat = __requesting'])
      let res = await nvim.call('pyxeval', ['stat'])
      assert.strictEqual(res, true)
      events.requesting = false
      await executePythonCode(nvim, ['stat = __requesting'])
      res = await nvim.call('pyxeval', ['stat'])
      assert.strictEqual(res, false)
    })

    it('should check hasPython', () => {
      assert.strictEqual(hasPython(undefined), false)
      assert.strictEqual(hasPython({ context: 'context' }), true)
    })
  })
})
