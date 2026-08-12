// Merged from ui.test.ts, keymaps.test.ts, autocmds.test.ts and
// terminals.test.ts to share a single nvim session and reduce per-file
// startup overhead.
import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import which from 'which'
import { CancellationToken, Disposable, Emitter } from 'vscode-languageserver-protocol'
import { Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { AutocmdItem, createCommand, toAutocmdOption } from '../../core/autocmds'
import Keymaps, { getBufnr, getKeymapModifier } from '../../core/keymaps'
import Terminals from '../../core/terminals'
import * as ui from '../../core/ui'
import events from '../../events'
import { TerminalModel } from '../../model/terminal'
import { TextDocumentContentProvider } from '../../provider'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let keymaps: Keymaps
let terminals: Terminals
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  keymaps = workspace.keymaps
  terminals = new Terminals()
})

afterAll(async () => {
  await helper.shutdown()
  disposeAll(disposables)
})

afterEach(async () => {
  terminals.reset()
  disposeAll(disposables)
  await helper.reset()
})

describe('getCursorPosition()', () => {
  it('should get cursor position', async () => {
    await nvim.call('cursor', [1, 1])
    let res = await ui.getCursorPosition(nvim)
    assert.deepStrictEqual(res, {
      line: 0,
      character: 0
    })
  })
})

describe('moveTo()', () => {
  it('should moveTo position', async () => {
    await nvim.setLine('foo')
    await ui.moveTo(nvim, Position.create(0, 1), true)
    let res = await ui.getCursorPosition(nvim)
    assert.deepStrictEqual(res, { line: 0, character: 1 })
  })
})

describe('getCursorScreenPosition()', () => {
  it('should get cursor screen position', async () => {
    let res = await ui.getCursorScreenPosition(nvim)
    assert.notStrictEqual(res, undefined)
    assert.strictEqual(typeof res.row, 'number')
    assert.strictEqual(typeof res.col, 'number')
  })
})

describe('createFloatFactory()', () => {
  it('should create FloatFactory', async () => {
    let f = ui.createFloatFactory(nvim, { border: true, autoHide: false, breaks: false }, { close: true })
    await f.show([{ content: 'shown', filetype: 'txt' }])
    let activated = await f.activated()
    assert.strictEqual(activated, true)
    assert.strictEqual(f.window != null, true)
    let win = await helper.getFloat()
    assert.notStrictEqual(win, undefined)
    let id = await nvim.call('coc#float#get_related', [win.id, 'border', 0]) as number
    assert.ok((id) > (0))
    id = await nvim.call('coc#float#get_related', [win.id, 'close', 0]) as number
    assert.ok((id) > (0))
    await f.show([{ content: 'shown', filetype: 'txt' }], { offsetX: 10 })
    let curr = await helper.getFloat()
    assert.strictEqual(curr.id, win.id)
  })
})

describe('showMessage()', () => {
  it('should showMessage on vim', async () => {
    ui.echoMessages(nvim, 'my message', 'more', 'more')
    await helper.waitValue(async () => helper.getCmdline().then(s => s.includes('my message')), true)
    let cmdline = await helper.getCmdline()
    assert.match(cmdline, /my message/)
  })

  it('should get messageLevel', () => {
    let level = ui.toMessageLevel('error')
    assert.strictEqual(level, ui.MessageLevel.Error)
    level = ui.toMessageLevel('warning')
    assert.strictEqual(level, ui.MessageLevel.Warning)
    level = ui.toMessageLevel('more')
    assert.strictEqual(level, ui.MessageLevel.More)
  })
})

describe('getSelection()', () => {
  it('should return null when no selection exists', async () => {
    let res = await ui.getSelection(nvim, 'v')
    assert.strictEqual(res, null)
  })

  it('should return range for line selection', async () => {
    await nvim.setLine('foo')
    await nvim.input('V')
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'V')
    assert.deepStrictEqual(res, { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
  })

  it('should return range of current line', async () => {
    await nvim.command('normal! gg')
    let res = await ui.getSelection(nvim, 'currline')
    assert.deepStrictEqual(res, Range.create(0, 0, 1, 0))
  })
})

describe('selectRange()', () => {
  it('should select range #1', async () => {
    await nvim.call('setline', [1, ['foo', 'b']])
    await nvim.command('set selection=inclusive')
    await nvim.command('set virtualedit=onemore')
    await ui.selectRange(nvim, Range.create(0, 0, 1, 1), true)
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'v')
    assert.deepStrictEqual(res, Range.create(0, 0, 1, 1))
  })

  it('should select range #2', async () => {
    await nvim.call('setline', [1, ['foo', 'b']])
    await ui.selectRange(nvim, Range.create(0, 0, 1, 0), true)
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'v')
    assert.deepStrictEqual(res, Range.create(0, 0, 0, 3))
  })

  it('should select range #3', async () => {
    await ui.selectRange(nvim, Range.create(0, 0, 0, 0), true)
    let m = await nvim.mode
    assert.strictEqual(m.mode, 'v')
    await nvim.input('<esc>')
    await ui.selectRange(nvim, Range.create(0, 0, 0, 1), true)
  })
})

describe('doKeymap()', () => {
  it('should not throw when key not mapped', async () => {
    await keymaps.doKeymap('<C-a>', '')
  })

  it('should invoke exists keymap', async () => {
    let called = false
    keymaps.registerKeymap(['i', 'n'], 'test-keymap', () => {
      called = true
      return 'result'
    })
    let res = await keymaps.doKeymap('test-keymap', '')
    assert.strictEqual(res, 'result')
    assert.strictEqual(called, true)
  })
})

describe('registerKeymap()', () => {
  it('should getBufnr', () => {
    assert.strictEqual(getBufnr(3), 3)
    assert.strictEqual(getBufnr(true), 0)
  })

  it('should getKeymapModifier', () => {
    assert.strictEqual(getKeymapModifier('i', true), '<Cmd>')
    assert.strictEqual(getKeymapModifier('i'), '<C-o>')
    assert.strictEqual(getKeymapModifier('s'), '<Esc>')
    assert.strictEqual(getKeymapModifier('x'), '<C-U>')
    assert.strictEqual(getKeymapModifier('t'), '<Cmd>')
  })

  it('should throw for invalid key', (t) => {
    let err
    try {
      keymaps.registerKeymap(['i'], '', t.mock.fn())
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
  })

  it('should throw for duplicated key', async (t) => {
    keymaps.registerKeymap(['i'], 'tmp', t.mock.fn())
    let err
    try {
      keymaps.registerKeymap(['i'], 'tmp', t.mock.fn())
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
  })

  it('should register insert key mapping', async (t) => {
    let fn = t.mock.fn()
    disposables.push(keymaps.registerKeymap(['i'], 'test', fn))
    let res = await nvim.call('execute', ['verbose imap <Plug>(coc-test)'])
    assert.ok(typeof res === 'string' && res.includes('coc#_insert_key'))
  })

  it('should register with different options', async () => {
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    disposables.push(keymaps.registerKeymap(['n', 'v'], 'test', fn, {
      sync: false,
      cancel: false,
      silent: false,
      repeat: true
    }))
    let res = await nvim.exec(`verbose nmap <Plug>(coc-test)`, true)
    assert.ok((res).includes('coc#rpc#notify'))
    await nvim.eval(`feedkeys("\\<Plug>(coc-test)")`)
    await helper.waitValue(() => called, true)
  })
})

describe('registerExprKeymap()', () => {
  it('should visual key mapping', async () => {
    await nvim.setLine('foo')
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    disposables.push(keymaps.registerExprKeymap('x', 'x', fn))
    await nvim.command('normal! viw')
    await nvim.input('x<esc>')
    await helper.waitValue(() => called, true)
  })

  it('should register expr insert key mapping', async () => {
    let buf = await nvim.buffer
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    let disposable = keymaps.registerExprKeymap('i', 'x', fn, buf.id)
    let res = await nvim.exec('imap x', true)
    assert.ok((res).includes('coc#_insert_key'))
    await nvim.input('i')
    await nvim.input('x')
    await helper.waitValue(() => called, true)
    disposable.dispose()
    res = await nvim.exec('imap x', true)
    assert.ok((res).includes('No mapping found'))
  })

  it('should regist key mapping without cancel pum', async (t) => {
    let fn = t.mock.fn()
    let disposable = keymaps.registerExprKeymap('i', 'x', fn, false, false)
    let res = await nvim.exec('imap x', true)
    assert.ok((res).includes('coc#_insert_key'))
    disposable.dispose()
  })
})

describe('registerLocalKeymap', () => {
  it('should register local keymap by notification', async () => {
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let called = false
    let disposable = keymaps.registerLocalKeymap(bufnr, 'n', 'n', () => {
      called = true
      return ''
    }, true)
    let res = await nvim.exec('nmap n', true)
    await nvim.input('n')
    await helper.waitValue(() => called, true)
    disposable.dispose()
    res = await nvim.exec('nmap n', true)
    assert.ok((res).includes('No mapping found'))
  })

  it('should regist insert mode keymap', async () => {
    let bufnr = await nvim.call('bufnr', ['%']) as number
    await nvim.command('startinsert')
    let called = false
    let disposable = keymaps.registerLocalKeymap(bufnr, 'i', '<C-i>', () => {
      called = true
    }, { cancel: true })
    disposables.push(disposable)
    await helper.waitValue(async () => {
      let out = await nvim.exec('imap <C-i>', true)
      return out.includes('coc#_insert_key')
    }, true)
    await nvim.input('<C-i>')
    await helper.waitValue(() => called, true)
    called = false
    disposable = keymaps.registerLocalKeymap(bufnr, 'i', '<C-o>', () => {
      called = true
    }, { cancel: false })
    disposables.push(disposable)
    await helper.waitValue(async () => {
      let out = await nvim.exec('imap <C-o>', true)
      return out.includes('coc#_insert_key')
    }, true)
    await nvim.input('<C-o>')
    await helper.waitValue(() => called, true)
  })

  it('should regist cmd keymap', async () => {
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let called = false
    let disposable = keymaps.registerLocalKeymap(bufnr, 'x', '<C-i>', async () => {
      called = true
    }, { cmd: true })
    disposables.push(disposable)
    await nvim.setLine('foo')
    await nvim.command('normal! v$')
    let m = await nvim.mode
    assert.strictEqual(m.mode, 'v')
    await nvim.input('<C-i>')
    await helper.waitValue(() => called, true)
    m = await nvim.mode
    assert.strictEqual(m.mode, 'c')
  })
})

describe('watchers', () => {
  it('should watch options', async (t) => {
    await events.fire('OptionSet', ['showmode', 0, 1])
    let times = 0
    let fn = () => {
      times++
    }
    let disposable = workspace.watchOption('showmode', fn)
    disposables.push(workspace.watchOption('showmode', t.mock.fn()))
    nvim.command('set showmode', true)
    assert.ok((workspace.watchers.options.length) > (0))
    await helper.waitValue(() => times, 1)
    disposable.dispose()
    nvim.command('set noshowmode', true)
    await helper.wait(20)
    assert.strictEqual(times, 1)
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
    assert.strictEqual(times, 1)
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
    assert.ok((line).includes('Error on OptionSet'))
    called = false
    workspace.watchGlobal('y', fn, disposables)
    await nvim.command('let g:y = 2')
    await helper.waitValue(() => called, true)
    line = await helper.getCmdline()
    assert.ok((line).includes('Error on GlobalChange'))
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
    assert.deepStrictEqual(lines, ['sample text'])
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

  it('keeps the latest refresh content when an older refresh resolves late', async () => {
    let first: (v: string) => void = () => {}
    let second: (v: string) => void = () => {}
    let calls = 0
    let emitter = new Emitter<URI>()
    let provider: TextDocumentContentProvider = {
      onDidChange: emitter.event,
      provideTextDocumentContent: () => {
        calls++
        if (calls === 1) return 'initial content'
        if (calls === 2) return new Promise(resolve => {
          first = resolve
        })
        return new Promise(resolve => {
          second = resolve
        })
      }
    }
    let disposable = workspace.registerTextDocumentContentProvider('race', provider)
    await nvim.command('edit race://1')
    let doc = await workspace.document
    try {
      emitter.fire(URI.parse('race://1'))
      emitter.fire(URI.parse('race://1'))
      // newer refresh resolves first, then the stale first refresh
      second('new content')
      first('stale content')
      await helper.waitFor('getline', ['.'], 'new content')
      await helper.wait(50)
      let line = await nvim.getLine()
      assert.strictEqual(line, 'new content')
    } finally {
      disposable.dispose()
      await nvim.command('bwipeout!')
      await helper.waitValue(() => doc.attached, false)
    }
  })

  it('does not write the buffer after the provider is unregistered', async () => {
    let resolveContent: (v: string) => void = () => {}
    let emitter = new Emitter<URI>()
    let provider: TextDocumentContentProvider = {
      onDidChange: emitter.event,
      provideTextDocumentContent: () => {
        if (calls === 0) {
          calls++
          return 'initial content'
        }
        return new Promise(resolve => {
          resolveContent = resolve
        })
      }
    }
    let calls = 0
    let disposable = workspace.registerTextDocumentContentProvider('late', provider)
    await nvim.command('edit late://1')
    let doc = await workspace.document
    emitter.fire(URI.parse('late://1'))
    disposable.dispose()
    resolveContent('should not appear')
    await helper.wait(50)
    let line = await nvim.getLine()
    assert.notStrictEqual(line, 'should not appear')
    await nvim.command('bwipeout!')
    await helper.waitValue(() => doc.attached, false)
  })
})

async function getAutocmdIds(event: string, pattern?: string): Promise<number[]> {
  let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event }]) as any[]
  let ids: number[] = []
  for (let item of list) {
    if (pattern && item.pattern !== pattern) continue
    let command = item.cmd ?? item.command
    let match = /doAutocmd', \[(\d+)/.exec(command as string)
    if (match) ids.push(Number(match[1]))
  }
  return ids
}

async function triggerAutocmd(id: number): Promise<void> {
  await helper.plugin.cocAction('doAutocmd', id)
}

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
    assert.strictEqual(res, `autocmd coc_dynamic_autocmd BufEnter ++once ++nested  call coc#rpc#request('doAutocmd', [1, 3, 4])`)
  })

  it('should convert to autocmd option', () => {
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
    assert.deepStrictEqual(res, {
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
    let ids = await getAutocmdIds('CursorMoved')
    assert.strictEqual(ids.length, 1)
    await triggerAutocmd(ids[0])
    assert.strictEqual(times, 1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'CursorMoved' }]) as any[]
    assert.strictEqual(list.length, 0)
  })

  it('should remove autocmd from nvim on dispose', async () => {
    let pattern = `*.${crypto.randomUUID()}.js`
    let disposable = workspace.registerAutocmd({
      event: 'BufEnter',
      pattern,
      request: false,
      callback: () => {}
    })
    let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'BufEnter' }]) as any[]
    assert.strictEqual(list.filter(o => o.pattern === pattern).length, 1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'BufEnter' }]) as any[]
    assert.strictEqual(list.filter(o => o.pattern === pattern).length, 0)
  })

  it('should remove user autocmd from nvim on dispose', async () => {
    let name = `CocTestEvent${crypto.randomUUID().replace(/-/g, '')}`
    let disposable = workspace.registerAutocmd({
      event: `User ${name}`,
      callback: () => {}
    })
    let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'User' }]) as any[]
    assert.strictEqual(list.filter(o => o.pattern === name).length, 1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'User' }]) as any[]
    assert.strictEqual(list.filter(o => o.pattern === name).length, 0)
  })

  it('should keep same event autocmd after other is disposed', async () => {
    let first = 0
    let second = 0
    let disposable = workspace.registerAutocmd({
      event: 'CursorMoved',
      callback: () => { first++ }
    })
    workspace.registerAutocmd({
      event: 'CursorMoved',
      callback: () => { second++ }
    })
    let ids = await getAutocmdIds('CursorMoved')
    assert.strictEqual(ids.length, 2)
    for (let id of ids) await triggerAutocmd(id)
    assert.strictEqual(first + second, 2)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    ids = await getAutocmdIds('CursorMoved')
    assert.strictEqual(ids.length, 1)
    await triggerAutocmd(ids[0])
    assert.strictEqual(second, 2)
    assert.strictEqual(first, 1)
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
    let ids = await getAutocmdIds('CursorHold')
    assert.strictEqual(ids.length, 1)
    await triggerAutocmd(ids[0])
    assert.strictEqual(called, true)
    disposable.dispose()
  })

  it('should not throw on rejecting autocmd callback', async () => {
    let called = 0
    let disposable = workspace.registerAutocmd({
      event: 'CursorHold',
      request: true,
      callback: () => {
        called++
        return Promise.reject(new Error('my error'))
      }
    })
    let ids = await getAutocmdIds('CursorHold')
    assert.strictEqual(ids.length, 1)
    await triggerAutocmd(ids[0])
    assert.strictEqual(called, 1)
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
    let ids = await getAutocmdIds('User', 'CocJumpPlaceholder')
    assert.strictEqual(ids.length, 1)
    await triggerAutocmd(ids[0])
    assert.strictEqual(called, true)
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
    assert.strictEqual(cancelled, true)
  })

  it('should dispose', async () => {
    workspace.autocmds.dispose()
  })
})

describe('create terminal', () => {
  it('should use cleaned env', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash'),
      strictEnv: true
    })
    await helper.wait(20)
    terminal.sendText(`echo $NODE_ENV`, true)
    let buf = nvim.createBuffer(terminal.bufnr)
    await helper.waitFor('eval', [`join(getbufline(${terminal.bufnr},1,'$'),'\n')`], /\S/)
    let lines = await buf.lines
    assert.strictEqual(lines.includes('test'), false)
  })

  it('strictEnv forwards caller-provided variables to terminal startup', async (t) => {
    let call = nvim.call.bind(nvim)
    let spy = t.mock.method(nvim, 'call', (method, args) => {
      if (method === 'coc#terminal#start') return Promise.resolve([12345, 0]) as never
      return call(method, args) as never
    })
    try {
      await terminals.createTerminal(nvim, {
        name: `test-${crypto.randomUUID()}`,
        shellPath: which.sync('bash'),
        env: { COC_AUDIT_ENV: 'wanted' },
        strictEnv: true
      })
      let args = spy.mock.calls.find(call => call.arguments[0] === 'coc#terminal#start')?.arguments[1]
      assert.ok(Array.isArray(args))
      assert.deepStrictEqual(args[0], [which.sync('bash')])
      assert.strictEqual(typeof args[1], 'string')
      assert.deepStrictEqual(args.slice(2), [{ COC_AUDIT_ENV: 'wanted' }, true])
    } finally {
      spy.mock.restore()
    }
  })

  it('restores editor state when terminal start fails', async () => {
    let winCount = await nvim.call('winnr', ['$'])
    let winid = await nvim.call('win_getid')
    let model = new TerminalModel('bash', [], nvim)
    let fn = async () => {
      await model.start('/definitely/not/a/real/dir', { COC_AUDIT_ENV: 'new' })
    }
    await assert.rejects(fn())
    assert.strictEqual(await nvim.call('winnr', ['$']), winCount)
    assert.strictEqual(await nvim.call('win_getid'), winid)
    // the editor process environment is never mutated
    assert.strictEqual(await nvim.call('getenv', ['COC_AUDIT_ENV']), null)
  })

  it('should use custom shell command', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    assert.strictEqual(bufname.includes('bash'), true)
  })

  it('should use custom cwd', async () => {
    let basename = path.basename(os.tmpdir())
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      cwd: os.tmpdir()
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    assert.strictEqual(bufname.includes(basename), true)
  })

  it('should have exit code', async () => {
    let exitStatus
    terminals.onDidCloseTerminal(terminal => {
      exitStatus = terminal.exitStatus
    })
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash'),
      strictEnv: true
    })
    terminal.sendText('exit', true)
    await helper.waitFor('bufloaded', [terminal.bufnr], 0)
    await helper.waitValue(() => {
      return exitStatus != null
    }, true)
    assert.notStrictEqual(exitStatus.code, undefined)
  })

  it('should return false on show when buffer unloaded', async () => {
    let model = new TerminalModel('bash', [], nvim)
    await model.start()
    assert.notStrictEqual(model.bufnr, undefined)
    await nvim.command(`bd! ${model.bufnr}`)
    let res = await model.show()
    assert.strictEqual(res, false)
  })

  it('cleans the terminal channel map after exit and dispose', async () => {
    let base = await nvim.call('coc#terminal#_channel_count') as number
    // natural success exit
    let t1 = await terminals.createTerminal(nvim, {
      name: `clean-${crypto.randomUUID()}`,
      shellPath: which.sync('bash'),
      shellArgs: ['-c', 'echo done; exit 0']
    })
    await helper.waitFor('bufloaded', [t1.bufnr], 0)
    assert.strictEqual(await nvim.call('coc#terminal#_channel_count'), base)
    // nonzero exit
    let t2 = await terminals.createTerminal(nvim, {
      name: `clean-${crypto.randomUUID()}`,
      shellPath: which.sync('bash'),
      shellArgs: ['-c', 'exit 3']
    })
    await helper.waitFor('bufloaded', [t2.bufnr], 0)
    assert.strictEqual(await nvim.call('coc#terminal#_channel_count'), base)
    // manual dispose
    let t3 = await terminals.createTerminal(nvim, {
      name: `clean-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    t3.dispose()
    await helper.waitFor('bufloaded', [t3.bufnr], 0)
    assert.strictEqual(await nvim.call('coc#terminal#_channel_count'), base)
  })

  it('should not throw when show & hide disposed terminal', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    terminal.dispose()
    await terminal.show()
    await terminal.hide()
  })

  it('should show terminal on current window', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    let winid = await nvim.call('bufwinid', [terminal.bufnr])
    assert.ok((winid as number) > 0)
    await nvim.call('win_gotoid', [winid])
    await terminal.show()
  })

  it('should show terminal that shown', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    let res = await terminal.show(true)
    assert.strictEqual(res, true)
  })

  it('should show hidden terminal', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    await terminal.hide()
    await terminal.show()
  })

  it('should create terminal', async () => {
    let terminal = await window.createTerminal({
      name: `test-${crypto.randomUUID()}`,
    })
    assert.notStrictEqual(terminal, undefined)
    assert.notStrictEqual(terminal.processId, undefined)
    assert.notStrictEqual(terminal.name, undefined)
    terminal.dispose()
    await helper.waitValue(() => terminal.bufnr, undefined)
    assert.strictEqual(terminal.bufnr, undefined)
  })
})
