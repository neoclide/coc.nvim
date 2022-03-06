import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { executePythonCode, UltiSnippetContext } from '../../snippets/eval'
import { Placeholder, TextmateSnippet } from '../../snippets/parser'
import { CocSnippet } from '../../snippets/snippet'
import { SnippetVariableResolver } from '../../snippets/variableResolve'
import { UltiSnippetOption } from '../../types'
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

async function createSnippet(snippet: string, opts?: UltiSnippetOption, range = Range.create(0, 0, 0, 0), line = '') {
  let snip = new CocSnippet(snippet, Position.create(0, 0), nvim, new SnippetVariableResolver(nvim))
  let context: UltiSnippetContext
  if (opts) context = { range, line, ...opts, }
  await snip.init(context)
  return snip
}

describe('CocSnippet', () => {
  async function assertResult(snip: string, resolved: string) {
    let c = await createSnippet(snip, {})
    expect(c.toString()).toBe(resolved)
  }

  async function asssertPyxValue(code: string, res: any) {
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
    })

    it('should resolve variables in placeholders', async () => {
      await nvim.setLine('foo')
      await assertResult('$1 ${1:$TM_CURRENT_LINE}', 'foo foo')
      await assertResult('$1 ${1:$TM_CURRENT_LINE bar}', 'foo bar foo bar')
      await assertResult('$2 ${2:|${1:$TM_CURRENT_LINE}|}', '|foo| |foo|')
      await assertResult('$1 $2 ${2:${1:|$TM_CURRENT_LINE|}}', '|foo| |foo| |foo|')
    })

    it('should resolve variables in placeholders with default value', async () => {
      await assertResult('$1 ${1:${VISUAL:foo}}', 'foo foo')
    })

    it('should resolve for lower case variables', async () => {
      await assertResult('${foo:abcdef} ${bar}', 'abcdef bar')
      await assertResult('${1:${foo:abcdef}} ${1/^\\w\\w(.*)/$1/}', 'abcdef cdef')
    })
  })

  describe('code block initialize', () => {
    it('should init shell code block', async () => {
      await assertResult('`echo "hello"` world', 'hello world')
    })

    it('should init vim block', async () => {
      await assertResult('`!v eval("1 + 1")` = 2', '2 = 2')
    })

    it('should setup python globals', async () => {
      await helper.edit('t.js')
      await createSnippet('`!p snip.rv = fn`', {})
      await asssertPyxValue('fn', 't.js')
      await asssertPyxValue('path', /t\.js$/)
      await asssertPyxValue('t', [''])
      await asssertPyxValue('context', true)
      await createSnippet('`!p snip.rv = fn`', {
        regex: '^(im)',
        context: 'False'
      }, Range.create(0, 0, 0, 2), 'im')
      await asssertPyxValue('context', false)
      await asssertPyxValue('match.group(0)', 'im')
      await asssertPyxValue('match.group(1)', 'im')
    })

    it('should work with methods of snip', async () => {
      await nvim.command('setl shiftwidth=4 ft=txt tabstop=4 expandtab')
      await createSnippet('`!p snip.rv = "a"`', {}, Range.create(0, 4, 0, 8), '    abcd')
      await executePythonCode(nvim, [
        'snip.shift(1)',
        // ultisnip indent only when there's '\n' in snip.rv
        'snip += ""',
        'newLine = snip.mkline("foo")'
      ])
      await asssertPyxValue('newLine', '        foo')
      await executePythonCode(nvim, [
        'snip.unshift(1)',
        'newLine = snip.mkline("b")'
      ])
      await asssertPyxValue('newLine', '    b')
      await executePythonCode(nvim, [
        'snip.shift(1)',
        'snip.reset_indent()',
        'newLine = snip.mkline("f")'
      ])
      await asssertPyxValue('newLine', '    f')
      await executePythonCode(nvim, [
        'fff = snip.opt("&fff", "foo")',
        'ft = snip.opt("&ft", "ft")',
      ])
      await asssertPyxValue('fff', 'foo')
      await asssertPyxValue('ft', 'txt')
    })

    it('should init python code block', async () => {
      await assertResult('`!p snip.rv = "a"` = a', 'a = a')
      await assertResult('`!p snip.rv = t[1]` = ${1:a}', 'a = a')
      await assertResult('`!p snip.rv = t[1]` = ${1:`!v eval("\'a\'")`}', 'a = a')
      await assertResult('`!p snip.rv = t[1] + t[2]` = ${1:a} ${2:b}', 'ab = a b')
    })

    it('should init python placeholder', async () => {
      await assertResult('foo ${1/^\\|(.*)\\|$/$1/} ${1:|`!p snip.rv = "a"`|}', 'foo a |a|')
      await assertResult('foo $1 ${1:`!p snip.rv = "a"`}', 'foo a a')
      await assertResult('${1/^_(.*)/$1/} $1 aa ${1:`!p snip.rv = "_foo"`}', 'foo _foo aa _foo')
    })

    it('should init nested python placeholder', async () => {
      await assertResult('${1:foo`!p snip.rv = t[2]`} ${2:bar} $1', 'foobar bar foobar')
      await assertResult('${3:f${2:oo${1:b`!p snip.rv = "ar"`}}} `!p snip.rv = t[3]`', 'foobar foobar')
    })

    it('should recursive init python placeholder', async () => {
      await assertResult('${1:`!p snip.rv = t[2]`} ${2:`!p snip.rv = t[3]`} ${3:`!p snip.rv = t[4][0]`} ${4:bar}', 'b b b bar')
      await assertResult('${1:foo} ${2:`!p snip.rv = t[1][0]`} ${3:`!p snip.rv = ""`} ${4:`!p snip.rv = t[2]`}', 'foo f  f')
    })

    it('should update python block from placeholder', async () => {
      await assertResult('`!p snip.rv = t[1][0] if len(t[1]) > 0 else ""` ${1:`!p snip.rv = t[2]`} ${2:foo}', 'f foo foo')
    })

    it('should update nested placeholder values', async () => {
      let c = await createSnippet('${2:foo ${1:`!p snip.rv = "bar"`}} ${2/^\\w//} `!p snip.rv = t[2]`', {})
      expect(c.toString()).toBe('foo bar oo bar foo bar')
    })
  })

  describe('getContentBefore()', () => {
    it('should get text before marker', async () => {
      let c = await createSnippet('${1:foo} ${2:bar}', {})
      let markers = c.placeholders
      let p = markers[0].parent
      expect(p instanceof TextmateSnippet).toBe(true)
      expect(c.getContentBefore(p)).toBe('')
      expect(c.getContentBefore(markers[0])).toBe('')
      expect(c.getContentBefore(markers[1])).toBe('foo ')
    })

    it('should get text before nested marker', async () => {
      let c = await createSnippet('${1:foo} ${2:is nested with $4} $3 bar', {})
      let markers = c.placeholders as Placeholder[]
      let p = markers.find(o => o.index == 4)
      expect(c.getContentBefore(p)).toBe('foo is nested with ')
      p = markers.find(o => o.index == 0)
      expect(c.getContentBefore(p)).toBe('foo is nested with   bar')
    })

    it('should consider normal line break', async () => {
      let c = await createSnippet('${1:foo}\n${2:is nested with $4}', {})
      let markers = c.placeholders as Placeholder[]
      let p = markers.find(o => o.index == 4)
      expect(c.getContentBefore(p)).toBe('is nested with ')
    })

    it('should consider line break after update', async () => {
      let c = await createSnippet('${1:foo} ${2}', {})
      let p = c.getPlaceholder(1)
      await c.tmSnippet.update(nvim, p.marker, 'abc\ndef')
      let markers = c.placeholders as Placeholder[]
      let placeholder = markers.find(o => o.index == 2)
      expect(c.getContentBefore(placeholder)).toBe('def ')
    })
  })

  describe('updatePlaceholder()', () => {
    async function assertUpdate(text: string, value: string, result: string, index = 1): Promise<CocSnippet> {
      let c = await createSnippet(text, {})
      let p = c.getPlaceholder(index)
      expect(p != null).toBe(true)
      await c.tmSnippet.update(nvim, p.marker, value)
      expect(c.toString()).toBe(result)
      return c
    }

    it('should update variable placeholders', async () => {
      await assertUpdate('${foo} ${foo}', 'bar', 'bar bar')
      await assertUpdate('${foo} ${foo:x}', 'bar', 'bar bar')
      await assertUpdate('${1:${foo:x}} $1', 'bar', 'bar bar')
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
      let prev = s.getPrevPlaceholder(2)
      expect(prev).toBeDefined()
      expect(prev.value).toBe('foo')
      // python placeholder, reset to empty value
      await assertUpdate('${2:bar${1:foo}} $2 `!p snip.rv = t[1]`', 'bar', 'bar bar ', 2)
      // not reset since $1 still exists
      await assertUpdate('${2:bar${1:foo}} $2 $1 `!p snip.rv = t[1]`', 'bar', 'bar bar foo foo', 2)
    })
  })
})
