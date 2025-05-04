import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Emitter } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { AutocmdItem, createCommand, toAutocmdOption } from '../../core/autocmds'
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
  afterEach(() => {
    nvim.command(`autocmd! coc_dynamic_autocmd`, true)
  })

  it('should create command', () => {
    let res = createCommand(1, 'BufEnter', {
      callback: () => {},
      event: ['User Jump'],
      once: true,
      nested: true,
      arglist: ['3', '4'],
      request: true,
    })
    expect(res).toBe(`autocmd coc_dynamic_autocmd BufEnter ++once ++nested  call coc#rpc#request('doAutocmd', [1, 3, 4])`)
  })

  it('should convert to autocmd option ', () => {
    let item = new AutocmdItem(1, {
      stack: '',
      buffer: 1,
      pattern: '*.js',
      once: true,
      nested: true,
      arglist: ['2', '3'],
      event: 'BufEnter', callback: () => {}
    })
    let res = toAutocmdOption(item)
    expect(res).toEqual({
      group: "coc_dynamic_autocmd",
      buffer: 1,
      pattern: "*.js",
      once: true,
      nested: true,
      command: "call coc#rpc#notify('doAutocmd', [1, 2, 3])"
    })
  })

  it('should setup autocmd', async () => {
    await nvim.setLine('foo')
    let times = 0
    let disposable = workspace.registerAutocmd({
      event: ['CursorMoved'],
      request: true,
      callback: () => {
        times++
      }
    })
    nvim.command('doautocmd <nomodeline> CursorMoved', true)
    await helper.waitValue(() => times, 1)
    disposable.dispose()
    await nvim.command('doautocmd <nomodeline> CursorMoved')
    await helper.wait(10)
    expect(times).toBe(1)
  })

  it('should not throw on autocmd callback error', async () => {
    let called = false
    let disposable = workspace.registerAutocmd({
      event: 'CursorHold',
      request: false,
      callback: () => {
        called = true
        throw new Error('my error')
      }
    })
    nvim.command('doautocmd <nomodeline> CursorHold', true)
    await helper.waitValue(() => called, true)
    disposable.dispose()
  })

  it('should setup user autocmd', async () => {
    let called = false
    workspace.registerAutocmd({
      event: 'User CocJumpPlaceholder',
      callback: () => {
        called = true
      }
    })
    await nvim.command('doautocmd <nomodeline> User CocJumpPlaceholder')
    await helper.waitValue(() => called, true)
  })
})

describe('doAutocmd()', () => {
  it('should not throw when command id does not exist', async () => {
    await workspace.autocmds.doAutocmd(999, [])
  })

  it('should cancel timeout request autocmd', async () => {
    let cancelled = false
    workspace.autocmds.registerAutocmd({
      event: 'CursorMoved,CursorMovedI',
      request: true,
      callback: (token: CancellationToken) => {
        return new Promise(resolve => {
          let timer = setTimeout(() => {
            resolve()
          }, 5000)
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            resolve()
          })
        })
      },
      stack: ''
    })
    let autocmds = workspace.autocmds.autocmds
    let keys = autocmds.keys()
    let max = Math.max(...Array.from(keys))
    await workspace.autocmds.doAutocmd(max, [], 10)
    expect(cancelled).toBe(true)
  })

  it('should dispose', async () => {
    workspace.autocmds.dispose()
  })
})
