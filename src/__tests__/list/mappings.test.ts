import * as shared from '../sharedUtil'
import { nvim } from '../sharedUtil'
import BasicList from '../../list/basic'
import listConfiguration, { ListConfiguration } from '../../list/configuration'
import manager from '../../list/manager'
import { IList, ListContext, ListItem } from '../../list/types'
import { QuickfixItem } from '../../types'
import { disposeAll } from '../../util/index'
import window from '../../window'
import path from 'path'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import { afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'


class TestList extends BasicList {
  public name = 'test'
  public timeout = 3000
  public text = 'test'
  public detail = 'detail'
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    return new Promise(resolve => {
      let timer = setTimeout(() => {
        resolve([{ label: this.text }])
      }, this.timeout)
      token.onCancellationRequested(() => {
        if (timer) {
          clearTimeout(timer)
          resolve([])
        }
      })
    })
  }
}

let disposables: Disposable[] = []
let callSpy: any
let commandSpy: any
let evalSpy: any

function installSpies(t: any): void {
  callSpy = t.mock.method(nvim, 'call')
  commandSpy = t.mock.method(nvim, 'command')
  evalSpy = t.mock.method(nvim, 'eval')
}
const locations: ReadonlyArray<QuickfixItem> = [{
  filename: import.meta.filename,
  col: 2,
  lnum: 1,
  text: 'foo'
}, {
  filename: import.meta.filename,
  col: 1,
  lnum: 2,
  text: 'Bar'
}, {
  filename: import.meta.filename,
  col: 1,
  lnum: 3,
  text: 'option'
}]

async function waitPreviewWindow(): Promise<void> {
  await shared.waitValue(() => nvim.call('coc#list#has_preview').then(n => (n as number) > 0), true)
}

const lineList: IList = {
  name: 'lines',
  actions: [{
    name: 'open',
    execute: async item => {
      await window.moveTo({
        line: (item as ListItem).data.line,
        character: 0
      })
      // noop
    }
  }],
  defaultAction: 'open',
  async loadItems(_context, _token): Promise<ListItem[]> {
    let lines = []
    for (let i = 0; i < 100; i++) {
      lines.push(i.toString())
    }
    return lines.map((line, idx) => ({
      label: line,
      data: { line: idx }
    }))
  }
}

before(async () => {
  await nvim.setVar('coc_jump_locations', locations)
})

afterEach(async () => {
  manager.reset()
  await nvim.command('windo setl winfixbuf&')
})

describe('isValidAction()', () => {
  it('should check invalid action', t => {
    let mappings = manager.mappings
    assert.strictEqual(mappings.isValidAction('foo'), false)
    assert.strictEqual(mappings.isValidAction('do:switch'), true)
    assert.strictEqual(mappings.isValidAction('eval:@*'), true)
    assert.strictEqual(mappings.isValidAction('undefined:undefined'), false)
  })
})

describe('User mappings', () => {
  afterEach(editorReset)

  it('should not throw when session not exists', async t => {
    let mappings = manager.mappings
    let res = await mappings.navigate(true)
    assert.strictEqual(res, false)
    res = await mappings.navigate(false)
    assert.strictEqual(res, false)
  })

  it('should show warning for invalid key', async t => {
    assert.notStrictEqual(ListConfiguration, undefined)
    assert.strictEqual(listConfiguration.fixKey('<c-a>'), '<C-a>')
    let errorSpy = t.mock.method(window, 'showErrorMessage', (() => Promise.resolve(undefined)) as any)
    let warningSpy = t.mock.method(window, 'showWarningMessage', (() => Promise.resolve(undefined)) as any)
    listConfiguration.fixKey('<a')
    assert.ok(errorSpy.mock.calls.some(c => c.arguments[0] === 'Configured key "<a" not supported.'))
    let revert = shared.updateConfiguration('list.insertMappings', {
      xy: 'action:tabe',
    })
    assert.ok(warningSpy.mock.calls.some(c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('Invalid configuration')))
    revert()
    warningSpy.mock.resetCalls()
    revert = shared.updateConfiguration('list.insertMappings', {
      '<M-x>': 'action:tabe',
    })
    assert.ok(warningSpy.mock.calls.some(c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('Invalid configuration')))
    revert()
    warningSpy.mock.resetCalls()
    revert = shared.updateConfiguration('list.insertMappings', {
      '<C-a>': 'foo:bar',
    })
    assert.ok(warningSpy.mock.calls.some(c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('Invalid configuration')))
    revert()
  })

  it('should execute action keymap', async t => {
    installSpies(t)
    let revert = shared.updateConfiguration('list.insertMappings', {
      '<C-d>': 'action:quickfix',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-d>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'setqflist' && Array.isArray(c.arguments[1][0])))
    assert.ok(commandSpy.mock.calls.some(c => c.arguments[0] === 'copen' && c.arguments[1] === true))
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
    revert()
  })

  it('should execute expr keymap', async t => {
    installSpies(t)
    await shared.mockFunction('TabOpen', 'quickfix')
    shared.updateConfiguration('list.insertMappings', {
      '<C-t>': 'expr:TabOpen',
    })
    shared.updateConfiguration('list.normalMappings', {
      t: 'expr:TabOpen',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-t>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'TabOpen' && c.arguments[1] && typeof c.arguments[1][0] === 'object'))
    assert.ok(commandSpy.mock.calls.some(c => c.arguments[0] === 'copen' && c.arguments[1] === true))
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
    await nvim.command('close')
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('t')
    assert.ok(commandSpy.mock.calls.some(c => c.arguments[0] === 'copen' && c.arguments[1] === true))
    buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
  })

  it('should execute do mappings', async t => {
    shared.updateConfiguration('list.previousKeymap', '<C-j>')
    shared.updateConfiguration('list.nextKeymap', '<C-k>')
    shared.updateConfiguration('list.insertMappings', {
      '<C-n>': 'do:next',
      '<C-p>': 'do:previous',
      '<C-d>': 'do:exit',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-n>')
    let item = await manager.session?.ui.item
    assert.match(item.label, new RegExp(locations[1].text))
    await shared.listInput('<C-p>')
    item = await manager.session?.ui.item
    assert.match(item.label, new RegExp(locations[0].text))
    await shared.listInput('<C-k>')
    item = await manager.session?.ui.item
    assert.match(item.label, new RegExp(locations[1].text))
    await shared.listInput('<C-j>')
    item = await manager.session?.ui.item
    assert.match(item.label, new RegExp(locations[0].text))
    await shared.listInput('<C-d>')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should execute prompt mappings', async t => {
    shared.updateConfiguration('list.insertMappings', {
      '<C-p>': 'prompt:previous',
      '<C-n>': 'prompt:next',
      '<C-a>': 'prompt:start',
      '<C-e>': 'prompt:end',
      '<Left>': 'prompt:left',
      '<Right>': 'prompt:right',
      '<backspace>': 'prompt:deleteforward',
      '<C-x>': 'prompt:deletebackward',
      '<C-k>': 'prompt:removetail',
      '<C-u>': 'prompt:removeahead',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    for (let key of ['<C-p>', '<C-n>', '<C-a>', '<C-e>', '<Left>', '<Right>', '<backspace>', '<C-x>', '<C-k>', '<C-u>']) {
      await shared.listInput(key)
    }
    assert.strictEqual(manager.isActivated, true)
  })

  it('should execute feedkeys keymap', async t => {
    installSpies(t)
    shared.updateConfiguration('list.insertMappings', {
      '<C-f>': 'feedkeys:\\<C-f>',
      '<C-b>': 'feedkeys!:\\<C-b>',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-f>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'eval' && c.arguments[1] && c.arguments[1][0] === 'feedkeys("\\<C-f>", "i")'))
    await shared.listInput('<C-b>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'eval' && c.arguments[1] && c.arguments[1][0] === 'feedkeys("\\<C-b>", "in")'))
  })

  it('should execute normal keymap', async t => {
    shared.updateConfiguration('list.insertMappings', {
      '<C-g>': 'normal:G',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-g>')
    let line = await nvim.call('line', '.')
    assert.strictEqual(line, locations.length)
  })

  it('should execute command keymap', async t => {
    shared.updateConfiguration('list.insertMappings', {
      '<C-w>': 'command:wincmd p',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-w>')
    assert.strictEqual(manager.isActivated, true)
    let winnr = await nvim.call('winnr')
    assert.strictEqual(winnr, 1)
  })

  it('should execute call keymap', async t => {
    await shared.mockFunction('Test', 1)
    shared.updateConfiguration('list.insertMappings', {
      '<C-t>': 'call:Test',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-t>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should insert clipboard register to prompt', async t => {
    shared.updateConfiguration('list.insertMappings', {
      '<C-r>': 'prompt:paste',
    })
    await nvim.command('let @* = "foobar"')
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-r>')
    let { input } = manager.prompt
    assert.match(input, new RegExp('foobar'))
    await nvim.command('let @* = ""')
    await shared.listInput('<C-r>')
    assert.match(manager.prompt.input, new RegExp('foobar'))
  })

  it('should insert text from default register to prompt', async t => {
    shared.updateConfiguration('list.insertMappings', {
      '<C-v>': 'eval:@@',
    })
    await nvim.command('let @@ = "bar"')
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-v>')
    let { input } = manager.prompt
    assert.match(input, new RegExp('bar'))
  })
})

describe('doAction()', () => {
  afterEach(editorReset)

  it('should throw when action not found', async t => {
    let mappings = manager.mappings
    let fn = async () => {
      await mappings.doAction('foo:bar')
    }
    await assert.rejects(fn(), /doesn't exist/)
  })

  it('should not throw when session does not exist', async t => {
    let mappings = manager.mappings
    await mappings.doAction('do:selectall')
    await mappings.doAction('do:help')
    await mappings.doAction('do:refresh')
    await mappings.doAction('do:toggle')
    await mappings.doAction('do:jumpback')
    await mappings.doAction('prompt:previous')
    await mappings.doAction('prompt:next')
    await mappings.doAction('do:refresh')
  })

  it('should not throw when action name does not exist', async t => {
    await shared.mockFunction('MyExpr', '')
    let mappings = manager.mappings
    await mappings.doAction('expr', 'MyExpr')
  })
})

describe('getAction()', () => {
  it('should throw for invalid action', async t => {
    let mappings = manager.mappings
    let fn = () => {
      mappings.getAction('foo')
    }
    assert.throws(fn, Error)
    fn = () => {
      mappings.getAction('do:bar')
    }
    assert.throws(fn, Error)
  })
})

describe('Default normal mappings', () => {
  afterEach(editorReset)

  it('should invoke action', async t => {
    await manager.start(['--normal', '--no-quit', 'location'])
    await manager.session.ui.ready
    let winid = manager.session.ui.winid
    await shared.listInput('t')
    let nr = await nvim.call('tabpagenr')
    assert.strictEqual(nr, 2)
    await nvim.call('win_gotoid', [winid])
    await shared.listInput('s')
    let winnr = await nvim.call('winnr', ['$'])
    assert.strictEqual(winnr, 3)
    await nvim.call('win_gotoid', [winid])
    await shared.listInput('d')
    let filename = await nvim.call('expand', ['%']) as string
    assert.match(filename, new RegExp(path.basename(import.meta.filename)))
    await nvim.call('win_gotoid', [winid])
    await shared.listInput('<cr>')
    filename = await nvim.call('expand', ['%']) as string
    assert.match(filename, new RegExp(path.basename(import.meta.filename)))
  })

  it('should select all items by <C-a>', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('<C-a>')
    let selected = manager.session?.ui.selectedItems
    assert.strictEqual(selected.length, locations.length)
  })

  it('should stop by <C-b>', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('<C-b>')
    let loading = manager.session?.worker.isLoading
    assert.strictEqual(loading, false)
  })

  it('should jump back by <C-o>', async t => {
    let doc = await shared.createDocument()
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('<C-o>')
    let bufnr = await nvim.call('bufnr', ['%'])
    assert.strictEqual(bufnr, doc.bufnr)
  })

  it('should scroll preview window by <C-e>, <C-y>', async t => {
    await shared.createDocument()
    await manager.start(['--auto-preview', '--normal', 'location'])
    await manager.session.ui.ready
    await waitPreviewWindow()
    let winnr = await nvim.call('coc#list#has_preview') as number
    let winid = await nvim.call('win_getid', [winnr])
    await shared.listInput('<C-e>')
    let res = await nvim.call('getwininfo', [winid])
    assert.ok(res[0].topline > 1)
    await shared.listInput('<C-y>')
    res = await nvim.call('getwininfo', [winid])
    assert.ok(res[0].topline < 7)
  })

  it('should insert command by :', async t => {
    installSpies(t)
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput(':')
    assert.ok(evalSpy.mock.calls.some(c => c.arguments[0] === 'feedkeys(":")'))
    await nvim.eval('feedkeys("let g:x = 1\\<cr>", "in")')
    await shared.waitValue(() => {
      return nvim.getVar('x')
    }, 1)
  })

  it('should select action by <tab>', async t => {
    let originalCall = nvim.call.bind(nvim)
    installSpies(t)
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    // Select the 'tabe' action directly instead of driving the real
    // confirm dialog, the dialog input is timing sensitive under load.
    callSpy.mock.mockImplementation(((fname: string, args: any[], isNotify?: boolean): Promise<any> | null => {
      if (fname === 'confirm') return Promise.resolve(5)
      if (fname === 'coc#prompt#stop_prompt' || fname === 'coc#prompt#start_prompt') {
        return isNotify ? null : Promise.resolve()
      }
      return (originalCall as any)(fname, args, isNotify)
    }) as any)
    await shared.listInput('<tab>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'confirm' && typeof c.arguments[1][0] === 'string' && c.arguments[1][0].includes('Choose action:') && typeof c.arguments[1][1] === 'string'))
    let nr = await nvim.call('tabpagenr')
    assert.strictEqual(nr, 2)
  })

  it('should preview by p', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('p')
    let winnr = await nvim.call('coc#list#has_preview')
    assert.strictEqual(winnr, 2)
  })

  it('should stop task by <C-c>', async t => {
    disposables.push(manager.registerList(new TestList()))
    let p = manager.start(['--normal', 'test'])
    await shared.waitValue(() => manager.session?.worker.isLoading, true)
    await manager.mappings.doNormalKeymap('<C-c>')
    await p
    let len = manager.session?.ui.length
    assert.strictEqual(len, 0)
  })

  it('should cancel list by <esc>', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<esc>", "in")')
    await shared.waitValue(() => {
      return manager.isActivated
    }, false)
  })

  it('should reload list by <C-l>', async t => {
    let list = new TestList()
    list.timeout = 0
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'test'])
    await manager.session.ui.ready
    list.text = 'new'
    await shared.listInput('<C-l>')
    let line = await nvim.line
    assert.match(line, new RegExp('new'))
  })

  it('should toggle selection <space>', async t => {
    // Mock the nvim state toggleSelection reads so the toggle is
    // deterministic. Real cursor movement via feedkeys is asynchronous
    // and timing sensitive under load.
    let originalCall = nvim.call.bind(nvim)
    let spy = t.mock.method(nvim, 'call', ((fname: string, args: any[], isNotify?: boolean): Promise<any> | null => {
      if (fname === 'line') return Promise.resolve(1)
      if (fname === 'mode') return Promise.resolve('n')
      if (fname === 'win_gotoid') return Promise.resolve(1)
      return (originalCall as any)(fname, args, isNotify)
    }) as any)
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    try {
      await manager.onNormalInput(' ')
      await shared.waitValue(() => {
        return manager.session?.ui.selectedItems.length
      }, 1)
      await manager.onNormalInput(' ')
      await shared.waitValue(() => {
        return manager.session?.ui.selectedItems.length
      }, 0)
    } finally {
    }
  })

  it('should change to insert mode by i, o, a', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    let keys = ['i', 'I', 'o', 'O', 'a', 'A']
    for (let key of keys) {
      await shared.listInput(key)
      let mode = manager.prompt.mode
      assert.strictEqual(mode, 'insert')
      await shared.listInput('<C-o>')
      mode = manager.prompt.mode
      assert.strictEqual(mode, 'normal')
    }
  })

  it('should show help by ?', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('?')
    let bufname = await nvim.call('bufname', '%')
    assert.strictEqual(bufname, '[LIST HELP]')
  })
})

describe('list insert mappings', () => {
  afterEach(editorReset)

  it('should open by <cr>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<cr>')
    let bufname = await nvim.call('expand', ['%:p']) as string
    assert.match(bufname, new RegExp('mappings\\.test\\.(?:js|ts)'))
  })

  it('should paste input by <C-v>', async t => {
    await nvim.command('let @* = "foo"')
    await nvim.command('let @@ = "foo"')
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-v>')
    let input = manager.prompt.input
    assert.strictEqual(input, 'foo')
  })

  it('should insert register content by <C-r>', async t => {
    await nvim.command('let @* = "foo"')
    await nvim.command('let @@ = "foo"')
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-r>')
    await shared.listInput('*')
    let input = manager.prompt.input
    assert.strictEqual(input, 'foo')
    await shared.listInput('<C-r>')
    await shared.listInput('<')
    input = manager.prompt.input
    assert.strictEqual(input, 'foo')
    manager.prompt.reset()
  })

  it('should cancel by <esc>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<esc>')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should select action by insert <tab>', async t => {
    let originalCall = nvim.call.bind(nvim)
    installSpies(t)
    await manager.start(['location'])
    await manager.session.ui.ready
    // Select the default 'open' action directly instead of driving the
    // real confirm dialog, the dialog input is timing sensitive under
    // load.
    callSpy.mock.mockImplementation(((fname: string, args: any[], isNotify?: boolean): Promise<any> | null => {
      if (fname === 'confirm') return Promise.resolve(1)
      if (fname === 'coc#prompt#stop_prompt' || fname === 'coc#prompt#start_prompt') {
        return isNotify ? null : Promise.resolve()
      }
      return (originalCall as any)(fname, args, isNotify)
    }) as any)
    await shared.listInput('<tab>')
    assert.ok(callSpy.mock.calls.some(c => c.arguments[0] === 'confirm' && typeof c.arguments[1][0] === 'string' && c.arguments[1][0].includes('Choose action:') && typeof c.arguments[1][1] === 'string'))
    await shared.waitFor('bufname', ['%'], new RegExp(path.basename(import.meta.filename)))
  })

  it('should select action for visual selected items', async t => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.waitPrompt()
    await nvim.input('V')
    await shared.waitFor('mode', [], /v/i)
    await nvim.input('2')
    await shared.wait(30)
    await nvim.input('j')
    await shared.wait(30)
    await manager.doAction('quickfix')
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
  })

  it('should stop loading by <C-c>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-c>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should reload by <C-l>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-l>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should change to normal mode by <C-o>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-o>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should select line by <down> and <up>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<down>", "in")')
    await nvim.eval('feedkeys("\\<up>", "in")')
    assert.strictEqual(manager.isActivated, true)
    let line = await nvim.line
    assert.match(line, new RegExp('foo'))
  })

  it('should move cursor by <left> and <right>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('f')
    await shared.listInput('<left>')
    await shared.listInput('<left>')
    await shared.listInput('a')
    await shared.listInput('<right>')
    await shared.listInput('<right>')
    await shared.listInput('c')
    let input = manager.prompt.input
    let mode = manager.prompt.mode
    manager.prompt.input = input
    manager.prompt.mode = mode
    await shared.listInput('<home>')
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    assert.strictEqual(input, 'afc')
  })

  it('should move cursor by leftword and rightword', async t => {
    let revert = shared.updateConfiguration('list.insertMappings', {
      '<A-b>': 'prompt:leftword',
      '<A-f>': 'prompt:rightword',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('aaa bbb ccc') // -> aaa bbb ccc|
    await shared.listInput('<A-b>')       // -> aaa bbb |ccc
    await shared.listInput('<A-b>')       // -> aaa |bbb ccc
    await shared.listInput('ddd ')        // -> aaa ddd |bbb ccc
    await shared.listInput('<A-f>')       // -> aaa ddd bbb |ccc
    await shared.listInput('eee ')        // -> aaa ddd bbb eee |ccc
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<A-b>'), true)
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<A-f>'), true)
    let input = manager.prompt.input
    revert()
    assert.strictEqual(input, 'aaa ddd bbb eee ccc')
  })

  it('should move cursor by <end> and <home>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('ff')
    await shared.listInput('<home>')
    await shared.listInput('<end>')
    await shared.listInput('<end>')
    let input = manager.prompt.input
    manager.prompt.removeWord()
    manager.prompt.removeWord()
    manager.prompt.removeTail()
    manager.prompt.removeTail()
    assert.strictEqual(input, 'ff')
  })

  it('should move cursor by <PageUp> <PageDown> <C-d>', async t => {
    disposables.push(manager.registerList(lineList))
    await manager.start(['lines'])
    await manager.session.ui.ready
    await shared.listInput('<PageDown>')
    await shared.listInput('<PageUp>')
    await shared.listInput('<C-d>')
  })

  it('should scroll window by <C-f> and <C-b>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-f>')
    await shared.listInput('<C-b>')
  })

  it('should change input by <Backspace>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('f')
    await shared.listInput('<backspace>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-b>', async t => {
    let revert = shared.updateConfiguration('list.insertMappings', {
      '<C-b>': 'prompt:removetail',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('f')
    await shared.listInput('o')
    await shared.listInput('o')
    await shared.listInput('<C-a>')
    await shared.listInput('<C-b>')
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<C-b>'), true)
    let input = manager.prompt.input
    revert()
    assert.strictEqual(input, '')
  })

  it('should change input by <C-h>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('f')
    await shared.listInput('<C-h>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-w>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('f')
    await shared.listInput('a')
    await shared.listInput('<C-w>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-u>', async t => {
    await manager.start(['--input=a', 'location'])
    await manager.session.ui.ready
    await shared.listInput('<C-u>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-n> and <C-p>', async t => {
    async function typeInput(input: string): Promise<void> {
      await manager.start(['location'])
      await manager.session.ui.ready
      for (let ch of input) {
        await shared.listInput(ch)
      }
      await manager.cancel()
    }
    await typeInput('foo')
    await typeInput('bar')
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-n>')
    let input = manager.prompt.input
    assert.ok(input.length > 0)
    await shared.listInput('<C-p>')
    input = manager.prompt.input
    assert.ok(input.length > 0)
  })

  it('should change matcher by <C-s>', async t => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await shared.listInput('<C-s>')
    let matcher = manager.session?.listOptions.matcher
    assert.strictEqual(matcher, 'strict')
    await shared.listInput('<C-s>')
    matcher = manager.session?.listOptions.matcher
    assert.strictEqual(matcher, 'regex')
    await shared.listInput('f')
    let len = manager.session?.ui.length
    assert.ok(len > 0)
  })
})

describe('evalExpression', () => {
  afterEach(editorReset)

  it('should exit list', async t => {
    shared.updateConfiguration('list.normalMappings', {
      t: 'do:exit',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    assert.strictEqual(manager.mappings.hasUserMapping('normal', 't'), true)
    await shared.listInput('t')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should cancel prompt', async t => {
    shared.updateConfiguration('list.normalMappings', {
      t: 'do:cancel',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('t')
    let res = await nvim.call('coc#prompt#activated')
    assert.strictEqual(res, 0)
  })

  it('should invoke normal command', async t => {
    let revert = shared.updateConfiguration('list.normalMappings', {
      x: 'normal!:G'
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput('x')
    revert()
    let lnum = await nvim.call('line', ['.']) as number
    assert.ok(lnum > 1)
  })

  it('should toggle, scroll preview', async t => {
    let revert = shared.updateConfiguration('list.normalMappings', {
      '<space>': 'do:toggle',
      a: 'do:toggle',
      b: 'do:previewtoggle',
      c: 'do:previewup',
      d: 'do:previewdown',
      e: 'prompt:insertregister',
      f: 'do:stop',
      g: 'do:togglemode',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await shared.listInput(' ')
    for (let key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await shared.listInput(key)
    }
    revert()
    assert.strictEqual(manager.isActivated, true)
  })
})
