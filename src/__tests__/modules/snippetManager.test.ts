import path from 'path'
import helper from '../helper'
import { SnippetProvider } from '../../types'
import extensions from '../../extensions'
import { Neovim } from '@chemzqm/neovim'
import snippetManager from '../../snippets/manager'

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
  it('should regist snippets provider', async () => {
    let provider: SnippetProvider = {
      getSnippets: () => {
        return [{
          body: 'foo',
          description: 'foo',
          prefix: 'foo'
        }]
      }
    }
    let disposable = snippetManager.registerSnippetProvider(provider)
    let snippets = await snippetManager.getSnippetsForLanguage('javascript')
    expect(snippets.length).toBe(1)
    expect(snippets[0].body).toBe('foo')
    disposable.dispose()
  })

  it('should get snippets from extensions', async () => {
    let extensionPath = path.resolve(__dirname, '../extensions/snippet-sample')
    await extensions.loadExtension(extensionPath)
    await helper.wait(100)
    let snippets = await snippetManager.getSnippetsForLanguage('javascript')
    expect(snippets.length).toBe(1)
    expect(snippets[0].prefix).toBe('for')
  })

  it('should not active insert plain snippet', async () => {
    let buf = await helper.edit('foo')
    await snippetManager.insertSnippet('foo')
    let line = await nvim.line
    expect(line).toBe('foo')
    expect(snippetManager.session).toBe(null)
    expect(snippetManager.getSession(buf.id)).toBeUndefined()
  })

  it('should goto next placeholder', async () => {
    await helper.edit('foo')
    await snippetManager.insertSnippet('${1:a} ${2:b}')
    await nvim.call('CocAction', 'snippetNext')
    await helper.wait(100)
    let col = await nvim.call('col', '.')
    expect(col).toBe(3)
  })

  it('should goto previous placeholder', async () => {
    await helper.edit('foo')
    await snippetManager.insertSnippet('${1:a} ${2:b}')
    await snippetManager.nextPlaceholder()
    await helper.wait(100)
    await nvim.call('CocAction', 'snippetPrev')
    await helper.wait(200)
    let col = await nvim.call('col', '.')
    expect(col).toBe(1)
  })

  it('should work remove kepmap on nextPlaceholder when session not exits', async () => {
    let buf = await helper.edit('bar')
    await nvim.call('coc#snippet#enable')
    await snippetManager.nextPlaceholder()
    await helper.wait(60)
    let val = await buf.getVar('coc_snippet_active')
    expect(val).toBe(0)
  })

  it('should work remove kepmap on previousPlaceholder when session not exits', async () => {
    let buf = await helper.edit('bar')
    await nvim.call('coc#snippet#enable')
    await snippetManager.previousPlaceholder()
    await helper.wait(60)
    let val = await buf.getVar('coc_snippet_active')
    expect(val).toBe(0)
  })

  it('should update placeholder on placeholder update', async () => {
    await helper.edit('foo')
    await nvim.setLine('bar')
    await snippetManager.insertSnippet('${1:foo} $1 ')
    let line = await nvim.line
    expect(line).toBe('foo foo bar')
    await helper.wait(60)
    await nvim.input('bar')
    await helper.wait(60)
    line = await nvim.line
    expect(line).toBe('bar bar bar')
  })

  it('should check position on InsertEnter', async () => {
    await helper.edit('foo')
    await nvim.setLine('bar')
    await snippetManager.insertSnippet('${1:foo} $1 ')
    await helper.wait(60)
    await nvim.input('<esc>A')
    await helper.wait(60)
    expect(snippetManager.session).toBeNull()
  })

  it('should cancel snippet session', async () => {
    let buf = await helper.edit('bar')
    await nvim.call('coc#snippet#enable')
    snippetManager.cancel()
    await helper.wait(60)
    let val = await buf.getVar('coc_snippet_active')
    expect(val).toBe(0)
    let active = await snippetManager.insertSnippet('${1:foo}')
    expect(active).toBe(true)
    snippetManager.cancel()
    expect(snippetManager.session).toBeNull()
  })

  it('should dispose', async () => {
    await helper.edit('foo')
    let active = await snippetManager.insertSnippet('${1:foo}')
    expect(active).toBe(true)
    snippetManager.dispose()
    expect(snippetManager.session).toBe(null)
  })

  it('should start new session if session exists', async () => {
    await helper.edit('foo')
    await nvim.setLine('bar')
    await snippetManager.insertSnippet('${1:foo} ')
    await helper.wait(40)
    await nvim.input('<esc>A')
    let active = await snippetManager.insertSnippet('${2:bar}')
    expect(active).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('foo barbar')
  })

  it('should start nest session', async () => {
    await helper.edit('nest')
    await snippetManager.insertSnippet('${1:foo} ${2:bar}')
    await nvim.input('<backspace>')
    await helper.wait(100)
    let active = await snippetManager.insertSnippet('${1:x} $1')
    expect(active).toBe(true)
  })
})
