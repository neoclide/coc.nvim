import { Neovim } from '@chemzqm/neovim'
import { Emitter } from 'vscode-languageserver-protocol'
import { createCommand } from '../../core/autocmds'
import { TextDocumentContentProvider } from '../../provider'
import { URI } from 'vscode-uri'
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

describe('contentProvider', () => {
  it('should not throw for scheme not registered', async () => {
    await workspace.contentProvider.onBufReadCmd('not_exists', '')
  })

  it('should register document content provider', async () => {
    let provider: TextDocumentContentProvider = {
      provideTextDocumentContent: (_uri, _token): string => 'sample text'
    }
    workspace.registerTextDocumentContentProvider('test', provider)
    await nvim.command('edit test://1')
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['sample text'])
  })

  it('should react on change event of document content provider', async () => {
    let text = 'foo'
    let emitter = new Emitter<URI>()
    let event = emitter.event
    let provider: TextDocumentContentProvider = {
      onDidChange: event,
      provideTextDocumentContent: (_uri, _token): string => text
    }
    workspace.registerTextDocumentContentProvider('jdk', provider)
    await nvim.command('edit jdk://1')
    let doc = await workspace.document
    text = 'bar'
    emitter.fire(URI.parse('jdk://1'))
    await helper.waitFor('getline', ['.'], 'bar')
    await nvim.command('bwipeout!')
    await helper.waitValue(() => doc.attached, false)
    emitter.fire(URI.parse('jdk://1'))
  })
})

describe('setupDynamicAutocmd()', () => {
  it('should create command', async () => {
    let callback = () => {}
    expect(createCommand(1, { callback, event: 'event', arglist: [], pattern: '*', request: true })).toMatch('event')
    expect(createCommand(1, { callback, event: 'event', arglist: ['foo'] })).toMatch('foo')
    expect(createCommand(1, { callback, event: ['foo', 'bar'], arglist: [] })).toMatch('foo')
    expect(createCommand(1, { callback, event: 'user Event', arglist: [] })).toMatch('user')
  })

  it('should setup autocmd on vim', async () => {
    await nvim.setLine('foo')
    let called = false
    let disposable = workspace.registerAutocmd({
      event: 'CursorMoved',
      request: true,
      callback: () => {
        called = true
      }
    })
    await helper.wait(10)
    await nvim.command('normal! $')
    await helper.waitValue(() => called, true)
    expect(called).toBe(true)
    disposable.dispose()
  })

  it('should setup user autocmd', async () => {
    let called = false
    workspace.registerAutocmd({
      event: 'User CocJumpPlaceholder',
      request: true,
      callback: () => {
        called = true
      }
    })
    workspace.autocmds.resetDynamicAutocmd()
    await helper.wait(10)
    await nvim.command('doautocmd <nomodeline> User CocJumpPlaceholder')
    await helper.waitValue(() => called, true)
  })
})

describe('doAutocmd()', () => {
  it('should not throw when command id does not exist', async () => {
    await workspace.autocmds.doAutocmd(999, [])
  })

  it('should dispose', async () => {
    workspace.autocmds.dispose()
  })
})
