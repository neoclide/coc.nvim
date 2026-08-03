// Merged from ui.test.ts, keymaps.test.ts, autocmds.test.ts and
// terminals.test.ts to share a single nvim session and reduce per-file
// startup overhead.
import { Neovim } from '../../neovim'
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
    expect(res).toEqual({
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
    expect(res).toEqual({ line: 0, character: 1 })
  })
})

describe('getCursorScreenPosition()', () => {
  it('should get cursor screen position', async () => {
    let res = await ui.getCursorScreenPosition(nvim)
    expect(res).toBeDefined()
    expect(typeof res.row).toBe('number')
    expect(typeof res.col).toBe('number')
  })
})

describe('createFloatFactory()', () => {
  it('should create FloatFactory', async () => {
    let f = ui.createFloatFactory(nvim, { border: true, autoHide: false, breaks: false }, { close: true })
    await f.show([{ content: 'shown', filetype: 'txt' }])
    let activated = await f.activated()
    expect(activated).toBe(true)
    expect(f.window != null).toBe(true)
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let id = await nvim.call('coc#float#get_related', [win.id, 'border', 0]) as number
    expect(id).toBeGreaterThan(0)
    id = await nvim.call('coc#float#get_related', [win.id, 'close', 0]) as number
    expect(id).toBeGreaterThan(0)
    await f.show([{ content: 'shown', filetype: 'txt' }], { offsetX: 10 })
    let curr = await helper.getFloat()
    expect(curr.id).toBe(win.id)
  })
})

describe('showMessage()', () => {
  it('should showMessage on vim', async () => {
    ui.echoMessages(nvim, 'my message', 'more', 'more')
    await helper.waitValue(async () => helper.getCmdline().then(s => s.includes('my message')), true)
    let cmdline = await helper.getCmdline()
    expect(cmdline).toMatch(/my message/)
  })

  it('should get messageLevel', () => {
    let level = ui.toMessageLevel('error')
    expect(level).toBe(ui.MessageLevel.Error)
    level = ui.toMessageLevel('warning')
    expect(level).toBe(ui.MessageLevel.Warning)
    level = ui.toMessageLevel('more')
    expect(level).toBe(ui.MessageLevel.More)
  })
})

describe('getSelection()', () => {
  it('should return null when no selection exists', async () => {
    let res = await ui.getSelection(nvim, 'v')
    expect(res).toBeNull()
  })

  it('should return range for line selection', async () => {
    await nvim.setLine('foo')
    await nvim.input('V')
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'V')
    expect(res).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
  })

  it('should return range of current line', async () => {
    await nvim.command('normal! gg')
    let res = await ui.getSelection(nvim, 'currline')
    expect(res).toEqual(Range.create(0, 0, 1, 0))
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
    expect(res).toEqual(Range.create(0, 0, 1, 1))
  })

  it('should select range #2', async () => {
    await nvim.call('setline', [1, ['foo', 'b']])
    await ui.selectRange(nvim, Range.create(0, 0, 1, 0), true)
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'v')
    expect(res).toEqual(Range.create(0, 0, 0, 3))
  })

  it('should select range #3', async () => {
    await ui.selectRange(nvim, Range.create(0, 0, 0, 0), true)
    let m = await nvim.mode
    expect(m.mode).toBe('v')
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
    expect(res).toBe('result')
    expect(called).toBe(true)
  })
})

describe('registerKeymap()', () => {
  it('should getBufnr', () => {
    expect(getBufnr(3)).toBe(3)
    expect(getBufnr(true)).toBe(0)
  })

  it('should getKeymapModifier', () => {
    expect(getKeymapModifier('i', true)).toBe('<Cmd>')
    expect(getKeymapModifier('i')).toBe('<C-o>')
    expect(getKeymapModifier('s')).toBe('<Esc>')
    expect(getKeymapModifier('x')).toBe('<C-U>')
    expect(getKeymapModifier('t')).toBe('<Cmd>')
  })

  it('should throw for invalid key', () => {
    let err
    try {
      keymaps.registerKeymap(['i'], '', vi.fn())
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw for duplicated key', async () => {
    keymaps.registerKeymap(['i'], 'tmp', vi.fn())
    let err
    try {
      keymaps.registerKeymap(['i'], 'tmp', vi.fn())
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should register insert key mapping', async () => {
    let fn = vi.fn()
    disposables.push(keymaps.registerKeymap(['i'], 'test', fn))
    let res = await nvim.call('execute', ['verbose imap <Plug>(coc-test)'])
    expect(res).toMatch('coc#_insert_key')
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
    expect(res).toMatch('coc#rpc#notify')
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
    expect(res).toMatch('coc#_insert_key')
    await nvim.input('i')
    await nvim.input('x')
    await helper.waitValue(() => called, true)
    disposable.dispose()
    res = await nvim.exec('imap x', true)
    expect(res).toMatch('No mapping found')
  })

  it('should regist key mapping without cancel pum', async () => {
    let fn = vi.fn()
    let disposable = keymaps.registerExprKeymap('i', 'x', fn, false, false)
    let res = await nvim.exec('imap x', true)
    expect(res).toMatch('coc#_insert_key')
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
    expect(res).toMatch('No mapping found')
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
    expect(m.mode).toBe('v')
    await nvim.input('<C-i>')
    await helper.waitValue(() => called, true)
    m = await nvim.mode
    expect(m.mode).toBe('c')
  })
})

describe('watchers', () => {
  it('should watch options', async () => {
    await events.fire('OptionSet', ['showmode', 0, 1])
    let times = 0
    let fn = () => {
      times++
    }
    let disposable = workspace.watchOption('showmode', fn)
    disposables.push(workspace.watchOption('showmode', vi.fn()))
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
    expect(res).toBe(`autocmd coc_dynamic_autocmd BufEnter ++once ++nested  call coc#rpc#request('doAutocmd', [1, 3, 4])`)
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
    let ids = await getAutocmdIds('CursorMoved')
    expect(ids.length).toBe(1)
    await triggerAutocmd(ids[0])
    expect(times).toBe(1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'CursorMoved' }]) as any[]
    expect(list.length).toBe(0)
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
    expect(list.filter(o => o.pattern === pattern).length).toBe(1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'BufEnter' }]) as any[]
    expect(list.filter(o => o.pattern === pattern).length).toBe(0)
  })

  it('should remove user autocmd from nvim on dispose', async () => {
    let name = `CocTestEvent${crypto.randomUUID().replace(/-/g, '')}`
    let disposable = workspace.registerAutocmd({
      event: `User ${name}`,
      callback: () => {}
    })
    let list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'User' }]) as any[]
    expect(list.filter(o => o.pattern === name).length).toBe(1)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    list = await nvim.call('nvim_get_autocmds', [{ group: 'coc_dynamic_autocmd', event: 'User' }]) as any[]
    expect(list.filter(o => o.pattern === name).length).toBe(0)
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
    expect(ids.length).toBe(2)
    for (let id of ids) await triggerAutocmd(id)
    expect(first + second).toBe(2)
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    ids = await getAutocmdIds('CursorMoved')
    expect(ids.length).toBe(1)
    await triggerAutocmd(ids[0])
    expect(second).toBe(2)
    expect(first).toBe(1)
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
    expect(ids.length).toBe(1)
    await triggerAutocmd(ids[0])
    expect(called).toBe(true)
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
    expect(ids.length).toBe(1)
    await triggerAutocmd(ids[0])
    expect(called).toBe(1)
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
    expect(ids.length).toBe(1)
    await triggerAutocmd(ids[0])
    expect(called).toBe(true)
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
    expect(lines.includes('test')).toBe(false)
  })

  it('should use custom shell command', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    expect(bufname.includes('bash')).toBe(true)
  })

  it('should use custom cwd', async () => {
    let basename = path.basename(os.tmpdir())
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      cwd: os.tmpdir()
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    expect(bufname.includes(basename)).toBe(true)
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
    expect(exitStatus.code).toBeDefined()
  })

  it('should return false on show when buffer unloaded', async () => {
    let model = new TerminalModel('bash', [], nvim)
    await model.start()
    expect(model.bufnr).toBeDefined()
    await nvim.command(`bd! ${model.bufnr}`)
    let res = await model.show()
    expect(res).toBe(false)
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
    expect(winid).toBeGreaterThan(0)
    await nvim.call('win_gotoid', [winid])
    await terminal.show()
  })

  it('should show terminal that shown', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${crypto.randomUUID()}`,
      shellPath: which.sync('bash')
    })
    let res = await terminal.show(true)
    expect(res).toBe(true)
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
    expect(terminal).toBeDefined()
    expect(terminal.processId).toBeDefined()
    expect(terminal.name).toBeDefined()
    terminal.dispose()
    await helper.waitValue(() => terminal.bufnr, undefined)
    expect(terminal.bufnr).toBeUndefined()
  })
})
