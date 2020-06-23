import { Neovim } from '@chemzqm/neovim'
import snippetManager from '../../snippets/manager'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
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

describe('snippet provider', () => {

  it('should not active insert plain snippet', async () => {
    let doc = await helper.createDocument()
    await snippetManager.insertSnippet('foo')
    let line = await nvim.line
    expect(line).toBe('foo')
    expect(snippetManager.session).toBe(null)
    expect(snippetManager.getSession(doc.bufnr)).toBeUndefined()
  })

  it('should goto next placeholder', async () => {
    await helper.createDocument()
    await snippetManager.insertSnippet('${1:a} ${2:b}')
    await snippetManager.nextPlaceholder()
    await helper.wait(30)
    let col = await nvim.call('col', '.')
    expect(col).toBe(3)
  })

  it('should goto previous placeholder', async () => {
    await helper.createDocument()
    await snippetManager.insertSnippet('${1:a} ${2:b}')
    await snippetManager.nextPlaceholder()
    await snippetManager.previousPlaceholder()
    let col = await nvim.call('col', '.')
    expect(col).toBe(1)
  })

  it('should remove keymap on nextPlaceholder when session not exits', async () => {
    let doc = await helper.createDocument()
    await nvim.call('coc#snippet#enable')
    await snippetManager.nextPlaceholder()
    await helper.wait(60)
    let val = await doc.buffer.getVar('coc_snippet_active')
    expect(val).toBe(0)
  })

  it('should remove keymap on previousPlaceholder when session not exits', async () => {
    let doc = await helper.createDocument()
    await nvim.call('coc#snippet#enable')
    await snippetManager.previousPlaceholder()
    await helper.wait(60)
    let val = await doc.buffer.getVar('coc_snippet_active')
    expect(val).toBe(0)
  })

  it('should update placeholder on placeholder update', async () => {
    await helper.createDocument()
    // await nvim.setLine('bar')
    await snippetManager.insertSnippet('$1\n${1/,/,\\n/g}')
    await helper.wait(60)
    await nvim.input('a,b')
    await helper.wait(200)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['a,b', 'a,', 'b'])
  })

  it('should adjust cursor position on update', async () => {
    await helper.createDocument()
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

  it('should check position on InsertEnter', async () => {
    await helper.createDocument()
    await nvim.input('ibar<left><left><left>')
    await snippetManager.insertSnippet('${1:foo} $1 ')
    await helper.wait(60)
    await nvim.input('<esc>A')
    await helper.wait(60)
    expect(snippetManager.session).toBeNull()
  })

  it('should cancel snippet session', async () => {
    let { buffer } = await helper.createDocument()
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

  it('should start new session if session exists', async () => {
    await helper.createDocument()
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
    await helper.createDocument()
    await snippetManager.insertSnippet('${1:foo} ${2:bar}')
    await nvim.input('<backspace>')
    await helper.wait(100)
    let active = await snippetManager.insertSnippet('${1:x} $1')
    expect(active).toBe(true)
  })

  it('should insert nest plain snippet', async () => {
    await helper.createDocument()
    await snippetManager.insertSnippet('${1:foo} ${2:bar}')
    await nvim.input('<backspace>')
    await helper.wait(100)
    let active = await snippetManager.insertSnippet('bar')
    expect(active).toBe(true)
    let cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([0, 3])
  })

  it('should resolve variables', async () => {
    await helper.createDocument()
    await snippetManager.insertSnippet('${foo:abcdef} ${bar}')
    let line = await nvim.line
    expect(line).toBe('abcdef bar')
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

  it('should respect preferCompleteThanJumpPlaceholder', async () => {
    let config = workspace.getConfiguration('suggest')
    config.update('preferCompleteThanJumpPlaceholder', true)
    await helper.createDocument()
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
  })

  it('should check jumpable', async () => {
    await helper.createDocument()
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

  it('should synchronize text on change final placeholder', async () => {
    let doc = await helper.createDocument()
    await nvim.command('startinsert')
    let res = await snippetManager.insertSnippet('$0empty$0')
    expect(res).toBe(true)
    await nvim.input('abc')
    await nvim.input('<esc>')
    await helper.wait(200)
    await doc.patchChange()
    let line = await nvim.line
    expect(line).toBe('abcemptyabc')
  })

  it('should dispose', async () => {
    await helper.createDocument()
    let active = await snippetManager.insertSnippet('${1:foo}')
    expect(active).toBe(true)
    snippetManager.dispose()
    expect(snippetManager.session).toBe(null)
  })
})
