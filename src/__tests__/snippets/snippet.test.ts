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
    expect(SnippetString.isSnippetString(null)).toBe(false)
    let snippetString = new SnippetString()
    expect(SnippetString.isSnippetString(snippetString)).toBe(true)
    expect(SnippetString.isSnippetString({})).toBe(false)
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
    expect(() => {
      toSnippetString(1 as any)
    }).toThrow(TypeError)
    expect(toSnippetString(new SnippetString())).toBe('')
  })
})

describe('CocSnippet', () => {
  async function assertResult(snip: string, resolved: string, opts?: UltiSnippetOption) {
    let c = await createSnippet(snip, opts)
    expect(c.text).toBe(resolved)
  }

  async function assertPyxValue(code: string, res: any) {
    let val = await nvim.call(`pyxeval`, code) as string
    if (typeof res === 'number' || typeof res === 'string' || typeof res === 'boolean') {
      expect(val).toBe(res)
    } else if (res instanceof RegExp) {
      expect(val).toMatch(res)
    } else {
      expect(val).toEqual(res)
    }
  }

  describe('resolveVariables()', () => {
    it('should padZero', () => {
      expect(padZero(1)).toBe('01')
      expect(padZero(10)).toBe('10')
    })

    it('should getVariablesCode', () => {
      expect(getVariablesCode({})).toBe('t = ()')
      expect(getVariablesCode({ 1: 'foo', 3: 'bar' })).toBe('t = ("","foo","","bar",)')
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
      expect(c.text.length).toBe(6)
      c = await createSnippet('$RANDOM_HEX')
      expect(c.text.length).toBe(6)
      c = await createSnippet('$UUID')
      expect(c.text).toMatch('-')
      c = await createSnippet('$RELATIVE_FILEPATH')
      expect(c.text).toMatch(path.basename(fsPath))
      c = await createSnippet('$WORKSPACE_NAME')
      expect(c.text.length).toBeGreaterThan(0)
      c = await createSnippet('$WORKSPACE_FOLDER')
      expect(c.text.length).toBeGreaterThan(0)
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
      expect(c.getUltiSnipOption(m, 'noExpand')).toBe(true)
      expect(c.getUltiSnipOption(c.tmSnippet, 'noExpand')).toBe(true)
      expect(c.getUltiSnipOption(new Text(''), 'trimTrailingWhitespace')).toBeUndefined()
    })
  })

  describe('findParent()', () => {
    it('should throw when not found', async () => {
      let snip = new TextmateSnippet()
      snip.appendChild(new Text('f'))
      let c = await createSnippet(snip)
      expect(() => {
        c.findParent(Range.create(1, 0, 1, 0))
      }).toThrow(Error)
    })

    it('should not use adjacent choice placeholder', async () => {
      let c = await createSnippet('a\n${1|one,two,three|}\nb')
      let res = c.findParent(Range.create(1, 0, 1, 0))
      expect(res.marker instanceof TextmateSnippet).toBe(true)
    })
  })

  describe('replaceWithText()', () => {
    it('should not return undefined when no change', async () => {
      let c = await createSnippet('${1:foo}')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 0), '', token)
      expect(res).toBeDefined()
      expect(res.snippetText).toBe('foo')
    })

    it('should replace with Text for choice placeholder', async () => {
      let c = await createSnippet(' ${1|one,two,three|} ')
      let res = c.replaceWithMarker(Range.create(0, 2, 0, 4), new Text('bar'))
      expect(res.children.length).toBe(1)
      expect(res.children[0].toString()).toBe('obar')
    })

    it('should not insert line break at the start of placeholder', async () => {
      let c = await createSnippet(' ${1:bar} ')
      let p = c.getPlaceholderByIndex(1).marker
      let res = c.replaceWithMarker(Range.create(0, 1, 0, 1), new Text('\n'), p)
      let text = c.tmSnippet.children[0] as Text
      expect(text.value).toBe(' \n')
      expect(res.toString()).toBe('bar')
    })

    it('should return undefined when cursor not changed', async () => {
      let doc = await workspace.document
      let c = await createSnippet('${1:foo}')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 3), '', token, undefined, doc.cursor)
      expect(res.delta).toBeUndefined()
    })

    it('should synchronize without related change', async () => {
      const assertChange = async (range: Range, newText: string, resultText: string) => {
        let token = (new CancellationTokenSource()).token
        let c = await createSnippet('begin ${1:foo} end')
        await c.replaceWithText(range, newText, token)
        expect(c.text).toBe(resultText)
        let start = Position.create(0, 0)
        let end = getEnd(start, resultText)
        expect(c.range).toEqual(Range.create(start, end))
        return c
      }
      // insert text
      await assertChange(Range.create(0, 0, 0, 0), 'aa ', 'aa begin foo end')
      // insert placeholder
      let snippet = await assertChange(Range.create(0, 6, 0, 6), 'xx', 'begin xxfoo end')
      let p = snippet.getPlaceholderByIndex(1)
      expect(p.value).toBe('xxfoo')
      // delete text of placeholder
      snippet = await assertChange(Range.create(0, 6, 0, 9), '', 'begin  end')
      p = snippet.getPlaceholderByIndex(1)
      expect(p.value).toBe('')
      // delete text
      await assertChange(Range.create(0, 0, 0, 6), '', 'foo end')
      //  delete Text and Placeholder
      snippet = await assertChange(Range.create(0, 0, 0, 8), '', 'o end')
      p = snippet.getPlaceholderByIndex(1)
      expect(p).toBeUndefined()
      let marker = snippet.getPlaceholderById(0.5, 0)
      expect(marker).toBeDefined()
      marker = snippet.getPlaceholderById(10, 9)
      expect(marker).toBeUndefined()
    })

    it('should prefer current placeholder', async () => {
      let m: Placeholder
      let c = await createSnippet('b ${1:${2:bar} foo} x')
      let marker = c.getPlaceholderByIndex(1).marker
      // use outer
      m = c.replaceWithMarker(Range.create(0, 2, 0, 3), new Text('insert'), marker) as Placeholder
      expect(m).toBe(marker)
      expect(m.children.length).toBe(1)
      expect(m.children[0].toString()).toBe('insertar foo')
      // use inner
      c = await createSnippet('b ${1:${2:bar} foo} x')
      m = c.replaceWithMarker(Range.create(0, 2, 0, 3), new Text('insert')) as Placeholder
      expect(m instanceof Placeholder).toBe(true)
      expect(m.index).toBe(2)
      expect(m.children.length).toBe(1)
      expect(m.children[0].toString()).toBe('insertar')
    })

    it('should insert with marker', async () => {
      let c; let m
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 0, 0, 0), new Text('before'))
      expect(m.toString()).toBe('beforefoo')
      expect(m.children.length).toBe(1)
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 1, 0, 1), new Text('before'))
      expect(m.toString()).toBe('fbeforeoo')
      expect(m.children.length).toBe(1)
      c = await createSnippet('${1:foo} ${2:bar}')
      m = c.replaceWithMarker(Range.create(0, 3, 0, 3), new Text('before'))
      expect(m.toString()).toBe('foobefore')
      expect(m.children.length).toBe(1)
    })

    it('should insert inside text', async () => {
      let c = await createSnippet('foo ${1:bar}')
      let marker = (new SnippetParser()).parse('${1:a}', true)
      let res = c.replaceWithMarker(Range.create(0, 1, 0, 2), marker)
      expect(res).toBe(c.tmSnippet)
      expect(c.tmSnippet.toString()).toBe('fao bar')
    })

    it('should change final placeholder', async () => {
      let c = await createSnippet('${1:foo} ${0:bar}')
      let changed = c.replaceWithMarker(Range.create(0, 4, 0, 4), new Text(' '))
      expect(changed.toString()).toBe('foo  bar')
      c.synchronize()
      changed = c.replaceWithMarker(Range.create(0, 5, 0, 6), new Text(''))
      expect(changed['index']).toBe(0)
      expect(changed.toString()).toBe('ar')
    })

    it('should replace with Text when placeholder is not primary', async () => {
      let c = await createSnippet('$1 ${1:foo}')
      let result = await c.replaceWithText(Range.create(0, 0, 0, 1), 'b', CancellationToken.None)
      expect(result.marker instanceof Text).toBe(true)
      expect(result.snippetText).toBe('boo foo')
    })
  })

  describe('replaceWithSnippet()', () => {
    it('should insert nested placeholder', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      c.deactivateSnippet(undefined)
      // expect(c.getUltiSnipActionCodes(undefined, 'postJump')).toBeUndefined()
      let res = await c.replaceWithSnippet(Range.create(0, 0, 0, 3), '${1:bar}')
      expect(res.toString()).toBe('bar')
      expect(res.parent.snippet.toString()).toBe('bar\nbar')
      expect(c.text).toBe('bar\nbar')
    })

    it('should insert python snippet to normal snippet', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      let p = c.getPlaceholderByIndex(1)
      expect(c.hasPython).toBe(false)
      let res = await c.replaceWithSnippet(p.range, '${1:x} `!p snip.rv = t[1]`', p.marker, { line: '', range: p.range, id: `1-1` })
      expect(res.toString()).toBe('x x')
      expect(c.text).toBe('x x\nx x')
      let r = c.getPlaceholderByMarker(res.first)
      let source = new CancellationTokenSource()
      let result = await c.replaceWithText(r.range, 'bar', source.token)
      expect(result.snippetText).toBe('bar x\nx x')
      expect(c.text).toBe('bar bar\nbar bar')
      expect(c.hasPython).toBe(true)
    })

    it('should not change match for original placeholders', async () => {
      let c = await createSnippet('`!p snip.rv = match.group(1)` $1', {
        regex: '^(\\w+)'
      }, Range.create(0, 0, 0, 3), 'foo')
      let p = c.getPlaceholderByIndex(1)
      expect(c.hasPython).toBe(true)
      expect(c.text).toBe('foo ')
      let context = {
        id: `1-1`,
        regex: '^(\\w+)',
        line: 'bar',
        range: Range.create(0, 0, 0, 3)
      }
      await executePythonCode(nvim, getInitialPythonCode(context))
      await c.replaceWithSnippet(p.range, '`!p snip.rv = match.group(1)`', p.marker, context)
      expect(c.text).toBe('foo bar')
    })

    it('should update with independent python global', async () => {
      let c = await createSnippet('${1:foo} `!p snip.rv = t[1]`', {})
      let range = Range.create(0, 0, 0, 3)
      let line = await nvim.line
      await c.replaceWithSnippet(range, '${1:bar} `!p snip.rv = t[1]`', undefined, { range, line, id: `1-1` })
      expect(c.text).toBe('bar bar bar bar')
      let token = (new CancellationTokenSource()).token
      let res = await c.replaceWithText(Range.create(0, 0, 0, 3), 'xy', token)
      expect(c.text).toBe('xy xy xy xy')
      expect(res.delta).toBeUndefined()
    })

    it('should not throw when parent not exist', async () => {
      let c = await createSnippet('${1:foo}', {})
      await c.onMarkerUpdate(new Placeholder(1), CancellationToken.None)
    })

    it('should not synchronize with none primary placeholder change', async () => {
      let c = await createSnippet('${1:foo}\n$1', {})
      let res = await c.replaceWithSnippet(Range.create(1, 0, 1, 3), '${1:bar}')
      expect(res.toString()).toBe('bar')
      expect(c.tmSnippet.toString()).toBe('foo\nbar')
    })
  })

  describe('getMarkerPosition', () => {
    it('should get position of marker', async () => {
      let c = await createSnippet('${1:foo}')
      expect(c.getMarkerPosition(new Placeholder(1))).toBeUndefined()
      let cloned = c.tmSnippet.clone()
      expect(c.getMarkerPosition(cloned)).toBeUndefined()
      expect(c.getMarkerPosition(c.tmSnippet)).toBeDefined()
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
      expect(c.text).toBe('\\frac{20}{}')
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
      expect(p != null).toBe(true)
      p.marker.setOnlyChild(new Text(value))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.None)
      expect(c.tmSnippet.toString()).toBe(result)
      return c
    }

    it('should update variable placeholders', async () => {
      await assertUpdate('${foo} ${foo}', 'bar', 'bar bar', 1, null)
      await assertUpdate('${1:${foo:x}} $1', 'bar', 'bar bar', 1, null)
    })

    it('should not update when cancelled', async () => {
      let c = await createSnippet('${1:foo} `!p snip.rv = t[1]`', {})
      let p = c.getPlaceholderByIndex(1)
      expect(p != null).toBe(true)
      p.marker.setOnlyChild(new Text('bar'))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.Cancelled)
      expect(c.tmSnippet.toString()).toBe('bar foo')
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
      expect(p).toBeDefined()
      p.marker.setOnlyChild(new Text('foo'))
      await c.tmSnippet.update(nvim, p.marker, CancellationToken.None)
      let t = c.tmSnippet.toString()
      expect(t.startsWith(first)).toBe(true)
      expect(t.split('\n').map(s => s.endsWith('foo'))).toEqual([true, true, true])
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
      expect(prev).toBeDefined()
      expect(prev.value).toBe('foo')
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
      expect(c.snippets[1]).toBe(nested)
      let marker = snip.first
      let next = getNextPlaceholder(marker, true)
      expect(next.index).toBe(2)
      expect(next.toString()).toBe('bar')
      {
        let m = nested.placeholders.find(o => o.index === 0)
        let next = getNextPlaceholder(m, false)
        expect(next.toString()).toBe('foo bar')
      }
    })

    it('should not throw when next not exists', async () => {
      expect(getNextPlaceholder(new Placeholder(1), true)).toBeUndefined()
      expect(getNextPlaceholder(undefined, true)).toBeUndefined()
    })
    it('should not throw when next not exists', async () => {
      expect(getNextPlaceholder(new Placeholder(1), true)).toBeUndefined()
      expect(getNextPlaceholder(undefined, true)).toBeUndefined()
    })

    it('should prefer primary placeholder', async () => {
      let c = await createSnippet('$1 $2 ${1:foo}')
      let p = c.getPlaceholderByIndex(2)
      let next = getNextPlaceholder(p.marker, false)
      expect(next.index).toBe(1)
      expect(next.primary).toBe(true)
    })
  })

  describe('getUltiSnipActionCodes()', () => {
    it('should not get codes when action not exists', () => {
      expect(getUltiSnipActionCodes(undefined, 'postJump')).toBeUndefined()
      expect(getUltiSnipActionCodes(new Text(''), 'postJump')).toBeUndefined()
      let snip = (new SnippetParser()).parse('${1:a}', true)
      expect(getUltiSnipActionCodes(snip, 'postJump')).toBeUndefined()
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
      expect(res.length).toBe(2)
    })
  })

  describe('getRanges getSnippetPlaceholders getTabStops', () => {
    it('should get ranges of placeholder', async () => {
      let c = await createSnippet('${2:${1:x} $1}\n$2', {})
      let p = c.getPlaceholderByIndex(1)
      let arr = c.getRanges(p.marker)
      expect(arr.length).toBe(2)
      expect(arr[0]).toEqual(Range.create(0, 0, 0, 1))
      expect(arr[1]).toEqual(Range.create(0, 2, 0, 3))
      expect(c.text).toBe('x x\nx x')
    })

    it('should get range of marker snippet', async () => {
      let c = await createSnippet('${1:foo}', {})
      let p = new Placeholder(1)
      expect(c.getSnippetRange(p)).toBeUndefined()
      let snip = (new SnippetParser()).parse('${1:a}', true)
      expect(c.getSnippetRange(snip.children[0])).toBeUndefined()
      let range = c.getSnippetRange(c.tmSnippet.children[0])
      expect(range).toEqual(Range.create(0, 0, 0, 3))
    })

    it('should get snippet tabstops', async () => {
      let c = await createSnippet('${1:foo}', {})
      let p = new Placeholder(1)
      expect(c.getSnippetTabstops(p)).toEqual([])
      let tabstops = c.getSnippetTabstops(c.tmSnippet.children[0])
      expect(tabstops.length).toBe(2)
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
      expect(err).toBeDefined()
    }

    it('should getTextBefore', () => {
      function assertText(r: number[], text: string, pos: [number, number], res: string): void {
        let t = getTextBefore(Range.create(r[0], r[1], r[2], r[3]), text, Position.create(pos[0], pos[1]))
        expect(t).toBe(res)
      }
      assertText([1, 1, 2, 1], 'abc\nd', [1, 1], '')
      assertText([1, 1, 2, 1], 'abc\nd', [2, 1], 'abc\nd')
      assertText([1, 1, 3, 1], 'abc\n\nd ', [3, 1], 'abc\n\nd')
    })

    it('should getTextAfter', () => {
      function assertText(r: number[], text: string, pos: [number, number], res: string): void {
        let t = getTextAfter(Range.create(r[0], r[1], r[2], r[3]), text, Position.create(pos[0], pos[1]))
        expect(t).toBe(res)
      }
      assertText([1, 1, 2, 1], 'abc\nd', [1, 1], 'abc\nd')
      assertText([1, 1, 2, 1], 'abc\nd', [2, 1], '')
      assertText([1, 1, 3, 1], 'abc\n\nd', [2, 0], '\nd')
      assertText([0, 0, 0, 3], 'abc', [0, 3], '')
    })

    it('should check shouldFormat', () => {
      expect(shouldFormat(' f')).toBe(true)
      expect(shouldFormat('a\nb')).toBe(true)
      expect(shouldFormat('foo')).toBe(false)
    })

    it('should normalizeSnippetString', () => {
      expect(normalizeSnippetString('a\n\n\tb', '  ', {
        insertSpaces: true,
        trimTrailingWhitespace: true,
        tabSize: 2
      })).toBe('a\n\n    b')
      expect(normalizeSnippetString('a\n\n  b', '\t', {
        insertSpaces: false,
        trimTrailingWhitespace: true,
        tabSize: 2
      })).toBe('a\n\n\t\tb')
      let res = normalizeSnippetString('a\n\n\tb', '\t', {
        insertSpaces: false,
        trimTrailingWhitespace: false,
        noExpand: true,
        tabSize: 2
      })
      expect(res).toBe('a\n\t\n\t\tb')
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
      expect(convertRegex('\\A')).toBe('^')
      expect(convertRegex('f(?#abc)b')).toBe('fb')
      expect(convertRegex('f(?P<abc>def)b')).toBe('f(?<abc>def)b')
      expect(convertRegex('f(?P=abc)b')).toBe('f\\k<abc>b')
    })

    it('should catch error with executePythonCode', async () => {
      let fn = async () => {
        await executePythonCode(nvim, ['INVALID_CODE'])
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should set error with addPythonTryCatch', async () => {
      let code = addPythonTryCatch('INVALID_CODE', true)
      await nvim.command(`pyx ${code}`)
      let msg = await nvim.getVar('errmsg')
      expect(msg).toBeDefined()
      expect(msg).toMatch('INVALID_CODE')
    })

    it('should cancel code block eval when necessary', async (): Promise<void> => {
      {
        let block = new CodeBlock('echo "foo"', 'shell')
        await block.resolve(nvim, CancellationToken.Cancelled)
        expect(block.len()).toBe(0)
      }
      {
        let block = new CodeBlock('bufnr("%")', 'vim')
        await block.resolve(nvim, CancellationToken.None)
        let bufnr = await nvim.eval('bufnr("%")')
        expect(block.value).toBe(`${bufnr}`)
      }
      {
        let block = new CodeBlock('v:null', 'vim')
        await block.resolve(nvim)
        expect(block.value).toBe('')
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
      expect(parseCommentstring('a%sb')).toBeUndefined()
      expect(parseCommentstring('// %s')).toBe('//')
      expect(parseComments('')).toEqual({
        start: undefined,
        end: undefined,
        single: undefined
      })
      expect(parseComments('s:/*')).toEqual({
        start: '/*',
        end: undefined,
        single: undefined
      })
      expect(parseComments('e:*/')).toEqual({
        end: '*/',
        start: undefined,
        single: undefined
      })
      expect(parseComments(':#,:b')).toEqual({
        end: undefined,
        start: undefined,
        single: '#'
      })
    })

    it('should set request variable', async () => {
      events.requesting = true
      await executePythonCode(nvim, ['stat = __requesting'])
      let res = await nvim.call('pyxeval', ['stat'])
      expect(res).toBe(true)
      events.requesting = false
      await executePythonCode(nvim, ['stat = __requesting'])
      res = await nvim.call('pyxeval', ['stat'])
      expect(res).toBe(false)
    })

    it('should check hasPython', () => {
      expect(hasPython(undefined)).toBe(false)
      expect(hasPython({ context: 'context' })).toBe(true)
    })
  })
})
