import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { createCommand } from '../../core/autocmds'
import events from '../../events'
import { TextDocumentContentProvider } from '../../provider'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
  disposeAll(disposables)
})

describe('watchers', () => {
  it('should watch options', async () => {
    await events.fire('OptionSet', ['showmode', 0, 1])
    let times = 0
    let fn = () => {
      times++
    }
    let disposable = workspace.watchOption('showmode', fn)
    disposables.push(workspace.watchOption('showmode', jest.fn()))
    nvim.command('set showmode', true)
    expect(workspace.watchers.options.length).toBeGreaterThan(0)
    await helper.waitValue(() => times, 1)
    disposable.dispose()
    nvim.command('set noshowmode', true)
    await helper.wait(20)
    expect(times).toBe(1)
  })

  it('should watch global', async () => {
    await events.fire('GlobalChange', ['x', 0, 1])
    let times = 0
    let fn = () => {
      times++
    }
    let disposable = workspace.watchGlobal('x', fn)
    workspace.watchGlobal('x', undefined, disposables)
    workspace.watchGlobal('x', undefined, disposables)
    await nvim.command('let g:x = 1')
    await helper.waitValue(() => times, 1)
    disposable.dispose()
    await nvim.command('let g:x = 2')
    await helper.wait(20)
    expect(times).toBe(1)
  })

  it('should show error on watch callback error', async () => {
    let called = false
    let fn = () => {
      called = true
      throw new Error('error')
    }
    workspace.watchOption('showmode', fn, disposables)
    nvim.command('set showmode', true)
    await helper.waitValue(() => called, true)
    let line = await helper.getCmdline()
    expect(line).toMatch('Error on OptionSet')
    called = false
    workspace.watchGlobal('y', fn, disposables)
    await nvim.command('let g:y = 2')
    await helper.waitValue(() => called, true)
    line = await helper.getCmdline()
    expect(line).toMatch('Error on GlobalChange')
  })
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
