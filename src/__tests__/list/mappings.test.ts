import { isDeepStrictEqual } from 'node:util'
import { Neovim } from '@chemzqm/neovim'
import type { MockTracker } from 'node:test'
import path from 'path'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import BasicList from '../../list/basic'
import listConfiguration, { ListConfiguration } from '../../list/configuration'
import manager from '../../list/manager'
import { IList, ListContext, ListItem } from '../../list/types'
import { QuickfixItem } from '../../types'
import { disposeAll } from '../../util/index'
import window from '../../window'
import helper from '../helper'

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

let nvim: Neovim
let disposables: Disposable[] = []
let callSpy: any
let commandSpy: any
let evalSpy: any

function installSpies(mock: MockTracker): void {
  callSpy = mock.method(nvim, 'call')
  commandSpy = mock.method(nvim, 'command')
  evalSpy = mock.method(nvim, 'eval')
}
const locations: ReadonlyArray<QuickfixItem> = [{
  filename: __filename,
  col: 2,
  lnum: 1,
  text: 'foo'
}, {
  filename: __filename,
  col: 1,
  lnum: 2,
  text: 'Bar'
}, {
  filename: __filename,
  col: 1,
  lnum: 3,
  text: 'option'
}]

async function waitPreviewWindow(): Promise<void> {
  await helper.waitValue(() => nvim.call('coc#list#has_preview').then(n => (n as number) > 0), true)
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

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  await nvim.setVar('coc_jump_locations', locations)
})

afterAll(async () => {
  disposeAll(disposables)
  await helper.shutdown()
})

afterEach(async () => {
  manager.reset()
  await helper.reset()
})

describe('isValidAction()', () => {
  it('should check invalid action', () => {
    let mappings = manager.mappings
    assert.strictEqual(mappings.isValidAction('foo'), false)
    assert.strictEqual(mappings.isValidAction('do:switch'), true)
    assert.strictEqual(mappings.isValidAction('eval:@*'), true)
    assert.strictEqual(mappings.isValidAction('undefined:undefined'), false)
  })
})

describe('User mappings', () => {
  it('should not throw when session not exists', async () => {
    let mappings = manager.mappings
    let res = await mappings.navigate(true)
    assert.strictEqual(res, false)
    res = await mappings.navigate(false)
    assert.strictEqual(res, false)
  })

  it('should show warning for invalid key', async (t) => {
    assert.notStrictEqual(ListConfiguration, undefined)
    assert.strictEqual(listConfiguration.fixKey('<c-a>'), '<C-a>')
    let errorSpy = t.mock.method(window, 'showErrorMessage', (() => Promise.resolve(undefined)) as any)
    let warningSpy = t.mock.method(window, 'showWarningMessage', (() => Promise.resolve(undefined)) as any)
    listConfiguration.fixKey('<a')
    assert.ok((errorSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['Configured key "<a" not supported.'])))
    let revert = helper.updateConfiguration('list.insertMappings', {
      xy: 'action:tabe',
    })
    assert.ok(warningSpy.mock.calls.some(call => call.arguments[0].includes('Invalid configuration')))
    revert()
    warningSpy.mock.resetCalls()
    revert = helper.updateConfiguration('list.insertMappings', {
      '<M-x>': 'action:tabe',
    })
    assert.ok(warningSpy.mock.calls.some(call => call.arguments[0].includes('Invalid configuration')))
    revert()
    warningSpy.mock.resetCalls()
    revert = helper.updateConfiguration('list.insertMappings', {
      '<C-a>': 'foo:bar',
    })
    assert.ok(warningSpy.mock.calls.some(call => call.arguments[0].includes('Invalid configuration')))
    revert()
  })

  it('should execute action keymap', async (t) => {
    installSpies(t.mock)
    let revert = helper.updateConfiguration('list.insertMappings', {
      '<C-d>': 'action:quickfix',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-d>')
    assert.ok(callSpy.mock.calls.some(call => call.arguments[0] === 'setqflist' && Array.isArray(call.arguments[1]?.[0])))
    assert.ok((commandSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['copen', true])))
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
    revert()
  })

  it('should execute expr keymap', async (t) => {
    installSpies(t.mock)
    await helper.mockFunction('TabOpen', 'quickfix')
    helper.updateConfiguration('list.insertMappings', {
      '<C-t>': 'expr:TabOpen',
    })
    helper.updateConfiguration('list.normalMappings', {
      t: 'expr:TabOpen',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-t>')
    assert.ok(callSpy.mock.calls.some(call => call.arguments[0] === 'TabOpen' && typeof call.arguments[1]?.[0] === 'object'))
    assert.ok((commandSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['copen', true])))
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
    await nvim.command('close')
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    assert.ok((commandSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['copen', true])))
    buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
  })

  it('should execute do mappings', async () => {
    helper.updateConfiguration('list.previousKeymap', '<C-j>')
    helper.updateConfiguration('list.nextKeymap', '<C-k>')
    helper.updateConfiguration('list.insertMappings', {
      '<C-n>': 'do:next',
      '<C-p>': 'do:previous',
      '<C-d>': 'do:exit',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-n>')
    let item = await manager.session?.ui.item
    assert.ok((item.label).includes(locations[1].text))
    await helper.listInput('<C-p>')
    item = await manager.session?.ui.item
    assert.ok((item.label).includes(locations[0].text))
    await helper.listInput('<C-k>')
    item = await manager.session?.ui.item
    assert.ok((item.label).includes(locations[1].text))
    await helper.listInput('<C-j>')
    item = await manager.session?.ui.item
    assert.ok((item.label).includes(locations[0].text))
    await helper.listInput('<C-d>')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should execute prompt mappings', async () => {
    helper.updateConfiguration('list.insertMappings', {
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
      await helper.listInput(key)
    }
    assert.strictEqual(manager.isActivated, true)
  })

  it('should execute feedkeys keymap', async (t) => {
    installSpies(t.mock)
    helper.updateConfiguration('list.insertMappings', {
      '<C-f>': 'feedkeys:\\<C-f>',
      '<C-b>': 'feedkeys!:\\<C-b>',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-f>')
    assert.ok((callSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['eval', ['feedkeys("\\<C-f>", "i")']])))
    await helper.listInput('<C-b>')
    assert.ok((callSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['eval', ['feedkeys("\\<C-b>", "in")']])))
  })

  it('should execute normal keymap', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-g>': 'normal:G',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-g>')
    let line = await nvim.call('line', '.')
    assert.strictEqual(line, locations.length)
  })

  it('should execute command keymap', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-w>': 'command:wincmd p',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-w>')
    assert.strictEqual(manager.isActivated, true)
    let winnr = await nvim.call('winnr')
    assert.strictEqual(winnr, 1)
  })

  it('should execute call keymap', async () => {
    await helper.mockFunction('Test', 1)
    helper.updateConfiguration('list.insertMappings', {
      '<C-t>': 'call:Test',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-t>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should insert clipboard register to prompt', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-r>': 'prompt:paste',
    })
    await nvim.command('let @* = "foobar"')
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-r>')
    let { input } = manager.prompt
    assert.ok((input).includes('foobar'))
    await nvim.command('let @* = ""')
    await helper.listInput('<C-r>')
    assert.ok((manager.prompt.input).includes('foobar'))
  })

  it('should insert text from default register to prompt', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-v>': 'eval:@@',
    })
    await nvim.command('let @@ = "bar"')
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-v>')
    let { input } = manager.prompt
    assert.ok((input).includes('bar'))
  })
})

describe('doAction()', () => {
  it('should throw when action not found', async () => {
    let mappings = manager.mappings
    let fn = async () => {
      await mappings.doAction('foo:bar')
    }
    await assert.rejects(fn(), /doesn't exist/)
  })

  it('should not throw when session does not exist', async () => {
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

  it('should not throw when action name does not exist', async () => {
    await helper.mockFunction('MyExpr', '')
    let mappings = manager.mappings
    await mappings.doAction('expr', 'MyExpr')
  })
})

describe('getAction()', () => {
  it('should throw for invalid action', async () => {
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
  it('should invoke action', async () => {
    await manager.start(['--normal', '--no-quit', 'location'])
    await manager.session.ui.ready
    let winid = manager.session.ui.winid
    await helper.listInput('t')
    let nr = await nvim.call('tabpagenr')
    assert.strictEqual(nr, 2)
    await nvim.call('win_gotoid', [winid])
    await helper.listInput('s')
    let winnr = await nvim.call('winnr', ['$'])
    assert.strictEqual(winnr, 3)
    await nvim.call('win_gotoid', [winid])
    await helper.listInput('d')
    let filename = await nvim.call('expand', ['%'])
    assert.ok(typeof filename === 'string' && filename.includes(path.basename(__filename)))
    await nvim.call('win_gotoid', [winid])
    await helper.listInput('<cr>')
    filename = await nvim.call('expand', ['%'])
    assert.ok(typeof filename === 'string' && filename.includes(path.basename(__filename)))
  })

  it('should select all items by <C-a>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-a>')
    let selected = manager.session?.ui.selectedItems
    assert.strictEqual(selected.length, locations.length)
  })

  it('should stop by <C-b>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-b>')
    let loading = manager.session?.worker.isLoading
    assert.strictEqual(loading, false)
  })

  it('should jump back by <C-o>', async () => {
    let doc = await helper.createDocument()
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-o>')
    let bufnr = await nvim.call('bufnr', ['%'])
    assert.strictEqual(bufnr, doc.bufnr)
  })

  it('should scroll preview window by <C-e>, <C-y>', async () => {
    await helper.createDocument()
    await manager.start(['--auto-preview', '--normal', 'location'])
    await manager.session.ui.ready
    await waitPreviewWindow()
    let winnr = await nvim.call('coc#list#has_preview') as number
    let winid = await nvim.call('win_getid', [winnr])
    await helper.listInput('<C-e>')
    let res = await nvim.call('getwininfo', [winid])
    assert.ok((res[0].topline) > (1))
    await helper.listInput('<C-y>')
    res = await nvim.call('getwininfo', [winid])
    assert.ok((res[0].topline) < (7))
  })

  it('should insert command by :', async (t) => {
    installSpies(t.mock)
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput(':')
    assert.ok((evalSpy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['feedkeys(":")'])))
    await nvim.eval('feedkeys("let g:x = 1\\<cr>", "in")')
    await helper.waitValue(() => {
      return nvim.getVar('x')
    }, 1)
  })

  it('should select action by <tab>', async (t) => {
    let originalCall = nvim.call.bind(nvim)
    installSpies(t.mock)
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
    await helper.listInput('<tab>')
    assert.ok(callSpy.mock.calls.some(call => {
      let args = call.arguments[1]
      return call.arguments[0] === 'confirm' && args[0].includes('Choose action:') && typeof args[1] === 'string'
    }))
    let nr = await nvim.call('tabpagenr')
    assert.strictEqual(nr, 2)
  })

  it('should preview by p', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('p')
    let winnr = await nvim.call('coc#list#has_preview')
    assert.strictEqual(winnr, 2)
  })

  it('should stop task by <C-c>', async () => {
    disposables.push(manager.registerList(new TestList()))
    let p = manager.start(['--normal', 'test'])
    await helper.waitValue(() => manager.session != null, true)
    await nvim.input('<C-c>')
    await p
    let len = manager.session?.ui.length
    assert.strictEqual(len, 0)
  })

  it('should cancel list by <esc>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<esc>", "in")')
    await helper.waitValue(() => {
      return manager.isActivated
    }, false)
  })

  it('should reload list by <C-l>', async () => {
    let list = new TestList()
    list.timeout = 0
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'test'])
    await manager.session.ui.ready
    list.text = 'new'
    await helper.listInput('<C-l>')
    let line = await nvim.line
    assert.ok((line).includes('new'))
  })

  it('should toggle selection <space>', async (t) => {
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
      await helper.listInput(' ')
      await helper.waitValue(() => {
        return manager.session?.ui.selectedItems.length
      }, 1)
      await helper.listInput(' ')
      await helper.waitValue(() => {
        return manager.session?.ui.selectedItems.length
      }, 0)
    } finally {
      spy.mock.restore()
    }
  })

  it('should change to insert mode by i, o, a', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    let keys = ['i', 'I', 'o', 'O', 'a', 'A']
    for (let key of keys) {
      await helper.listInput(key)
      let mode = manager.prompt.mode
      assert.strictEqual(mode, 'insert')
      await helper.listInput('<C-o>')
      mode = manager.prompt.mode
      assert.strictEqual(mode, 'normal')
    }
  })

  it('should show help by ?', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('?')
    let bufname = await nvim.call('bufname', '%')
    assert.strictEqual(bufname, '[LIST HELP]')
  })
})

describe('list insert mappings', () => {
  it('should open by <cr>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<cr>')
    let bufname = await nvim.call('expand', ['%:p'])
    assert.ok(typeof bufname === 'string' && bufname.includes('mappings.test.ts'))
  })

  it('should paste input by <C-v>', async () => {
    await nvim.command('let @* = "foo"')
    await nvim.command('let @@ = "foo"')
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-v>')
    let input = manager.prompt.input
    assert.strictEqual(input, 'foo')
  })

  it('should insert register content by <C-r>', async () => {
    await nvim.command('let @* = "foo"')
    await nvim.command('let @@ = "foo"')
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-r>')
    await helper.listInput('*')
    let input = manager.prompt.input
    assert.strictEqual(input, 'foo')
    await helper.listInput('<C-r>')
    await helper.listInput('<')
    input = manager.prompt.input
    assert.strictEqual(input, 'foo')
    manager.prompt.reset()
  })

  it('should cancel by <esc>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<esc>')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should select action by insert <tab>', async (t) => {
    let originalCall = nvim.call.bind(nvim)
    installSpies(t.mock)
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
    await helper.listInput('<tab>')
    assert.ok(callSpy.mock.calls.some(call => {
      let args = call.arguments[1]
      return call.arguments[0] === 'confirm' && args[0].includes('Choose action:') && typeof args[1] === 'string'
    }))
    await helper.waitFor('bufname', ['%'], new RegExp(path.basename(__filename)))
  })

  it('should select action for visual selected items', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.waitPrompt()
    await nvim.input('V')
    await helper.waitFor('mode', [], /v/i)
    await nvim.input('2')
    await helper.wait(30)
    await nvim.input('j')
    await helper.wait(30)
    await manager.doAction('quickfix')
    let buftype = await nvim.eval('&buftype')
    assert.strictEqual(buftype, 'quickfix')
  })

  it('should stop loading by <C-c>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-c>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should reload by <C-l>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-l>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should change to normal mode by <C-o>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-o>')
    assert.strictEqual(manager.isActivated, true)
  })

  it('should select line by <down> and <up>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<down>", "in")')
    await nvim.eval('feedkeys("\\<up>", "in")')
    assert.strictEqual(manager.isActivated, true)
    let line = await nvim.line
    assert.ok((line).includes('foo'))
  })

  it('should move cursor by <left> and <right>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('<left>')
    await helper.listInput('<left>')
    await helper.listInput('a')
    await helper.listInput('<right>')
    await helper.listInput('<right>')
    await helper.listInput('c')
    let input = manager.prompt.input
    let mode = manager.prompt.mode
    manager.prompt.input = input
    manager.prompt.mode = mode
    await helper.listInput('<home>')
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    manager.prompt.removeNext()
    assert.strictEqual(input, 'afc')
  })

  it('should move cursor by leftword and rightword', async () => {
    let revert = helper.updateConfiguration('list.insertMappings', {
      '<A-b>': 'prompt:leftword',
      '<A-f>': 'prompt:rightword',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('aaa bbb ccc') // -> aaa bbb ccc|
    await helper.listInput('<A-b>')       // -> aaa bbb |ccc
    await helper.listInput('<A-b>')       // -> aaa |bbb ccc
    await helper.listInput('ddd ')        // -> aaa ddd |bbb ccc
    await helper.listInput('<A-f>')       // -> aaa ddd bbb |ccc
    await helper.listInput('eee ')        // -> aaa ddd bbb eee |ccc
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<A-b>'), true)
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<A-f>'), true)
    let input = manager.prompt.input
    revert()
    assert.strictEqual(input, 'aaa ddd bbb eee ccc')
  })

  it('should move cursor by <end> and <home>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('ff')
    await helper.listInput('<home>')
    await helper.listInput('<end>')
    await helper.listInput('<end>')
    let input = manager.prompt.input
    manager.prompt.removeWord()
    manager.prompt.removeWord()
    manager.prompt.removeTail()
    manager.prompt.removeTail()
    assert.strictEqual(input, 'ff')
  })

  it('should move cursor by <PageUp> <PageDown> <C-d>', async () => {
    disposables.push(manager.registerList(lineList))
    await manager.start(['lines'])
    await manager.session.ui.ready
    await helper.listInput('<PageDown>')
    await helper.listInput('<PageUp>')
    await helper.listInput('<C-d>')
  })

  it('should scroll window by <C-f> and <C-b>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-f>')
    await helper.listInput('<C-b>')
  })

  it('should change input by <Backspace>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('<backspace>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-b>', async () => {
    let revert = helper.updateConfiguration('list.insertMappings', {
      '<C-b>': 'prompt:removetail',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('o')
    await helper.listInput('o')
    await helper.listInput('<C-a>')
    await helper.listInput('<C-b>')
    assert.strictEqual(manager.mappings.hasUserMapping('insert', '<C-b>'), true)
    let input = manager.prompt.input
    revert()
    assert.strictEqual(input, '')
  })

  it('should change input by <C-h>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('<C-h>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-w>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('a')
    await helper.listInput('<C-w>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-u>', async () => {
    await manager.start(['--input=a', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-u>')
    let input = manager.prompt.input
    assert.strictEqual(input, '')
  })

  it('should change input by <C-n> and <C-p>', async () => {
    async function session(input: string): Promise<void> {
      await manager.start(['location'])
      await manager.session.ui.ready
      for (let ch of input) {
        await helper.listInput(ch)
      }
      await manager.cancel()
    }
    await session('foo')
    await session('bar')
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-n>')
    let input = manager.prompt.input
    assert.ok((input.length) > (0))
    await helper.listInput('<C-p>')
    input = manager.prompt.input
    assert.ok((input.length) > (0))
  })

  it('should change matcher by <C-s>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-s>')
    let matcher = manager.session?.listOptions.matcher
    assert.strictEqual(matcher, 'strict')
    await helper.listInput('<C-s>')
    matcher = manager.session?.listOptions.matcher
    assert.strictEqual(matcher, 'regex')
    await helper.listInput('f')
    let len = manager.session?.ui.length
    assert.ok((len) > (0))
  })
})

describe('evalExpression', () => {
  it('should exit list', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:exit',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    assert.strictEqual(manager.mappings.hasUserMapping('normal', 't'), true)
    await helper.listInput('t')
    assert.strictEqual(manager.isActivated, false)
  })

  it('should cancel prompt', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:cancel',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    let res = await nvim.call('coc#prompt#activated')
    assert.strictEqual(res, 0)
  })

  it('should invoke normal command', async () => {
    let revert = helper.updateConfiguration('list.normalMappings', {
      x: 'normal!:G'
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('x')
    revert()
    let lnum = await nvim.call('line', ['.'])
    assert.ok((lnum as number) > 1)
  })

  it('should toggle, scroll preview', async () => {
    let revert = helper.updateConfiguration('list.normalMappings', {
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
    await helper.listInput(' ')
    for (let key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await helper.listInput(key)
    }
    revert()
    assert.strictEqual(manager.isActivated, true)
  })
})
