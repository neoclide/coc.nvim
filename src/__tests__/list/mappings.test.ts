import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable } from 'vscode-jsonrpc'
import path from 'path'
import BasicList from '../../list/basic'
import manager from '../../list/manager'
import window from '../../window'
import { ListContext, IList, ListItem, QuickfixItem } from '../../types'
import helper from '../helper'
import { disposeAll } from '../../util/index'

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

beforeEach(async () => {
  let m = await nvim.mode
  if (m.blocking) {
    console.error('nvim blocking', m)
  }
})

afterEach(async () => {
  manager.reset()
  await helper.reset()
})

describe('list normal mappings', () => {
  it('should tabopen by t', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(100)
    let nr = await nvim.call('tabpagenr')
    expect(nr).toBe(2)
  })

  it('should open by <cr>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<cr>')
    let bufname = await nvim.call('expand', ['%:p'])
    expect(bufname).toMatch('mappings.test.ts')
  })

  it('should stop by <C-c>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-c>')
    await helper.wait(50)
    let loading = manager.session?.worker.isLoading
    expect(loading).toBe(false)
  })

  it('should jump back by <C-o>', async () => {
    let doc = await helper.createDocument()
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-o>')
    await helper.wait(50)
    let bufnr = await nvim.call('bufnr', ['%'])
    expect(bufnr).toBe(doc.bufnr)
  })

  it('should scroll preview window by <C-e>, <C-y>', async () => {
    await helper.createDocument()
    await manager.start(['--auto-preview', '--normal', 'location'])
    await manager.session.ui.ready
    await helper.waitPreviewWindow()
    let winnr = await nvim.call('coc#list#has_preview') as number
    let winid = await nvim.call('win_getid', [winnr])
    await helper.listInput('<C-e>')
    let res = await nvim.call('getwininfo', [winid])
    expect(res[0].topline).toBeGreaterThan(1)
    await helper.listInput('<C-y>')
    res = await nvim.call('getwininfo', [winid])
    expect(res[0].topline).toBeLessThan(7)
  })

  it('should insert command by :', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput(':')
    await helper.wait(50)
    await nvim.eval('feedkeys("let g:x = 1\\<cr>", "in")')
    await helper.wait(50)
    let res = await nvim.getVar('x')
    expect(res).toBe(1)
  })

  it('should select action by <tab>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    void helper.listInput('<tab>')
    await helper.wait(100)
    await nvim.input('t')
    await helper.wait(100)
    let nr = await nvim.call('tabpagenr')
    expect(nr).toBe(2)
  })

  it('should preview by p', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('p')
    await helper.wait(50)
    let winnr = await nvim.call('coc#list#has_preview')
    expect(winnr).toBe(2)
  })

  it('should stop task by <C-c>', async () => {
    disposables.push(manager.registerList(new TestList(nvim)))
    let p = manager.start(['--normal', 'test'])
    await helper.wait(100)
    await nvim.input('<C-c>')
    await p
    let len = manager.session?.ui.length
    expect(len).toBe(0)
  })

  it('should cancel list by <esc>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<esc>", "in")')
    await helper.wait(100)
    expect(manager.isActivated).toBe(false)
  })

  it('should reload list by <C-l>', async () => {
    let list = new TestList(nvim)
    list.timeout = 0
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'test'])
    await manager.session.ui.ready
    list.text = 'new'
    await helper.listInput('<C-l>')
    await helper.wait(30)
    let line = await nvim.line
    expect(line).toMatch('new')
  })

  it('should select all items by <C-a>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-a>')
    let selected = manager.session?.ui.selectedItems
    expect(selected.length).toBe(locations.length)
  })

  it('should toggle selection <space>', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput(' ')
    let selected = manager.session?.ui.selectedItems
    expect(selected.length).toBe(1)
    await helper.listInput('k')
    await helper.listInput(' ')
    selected = manager.session?.ui.selectedItems
    expect(selected.length).toBe(0)
  })

  it('should change to insert mode by i, o, a', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    let keys = ['i', 'I', 'o', 'O', 'a', 'A']
    for (let key of keys) {
      await helper.listInput(key)
      let mode = manager.prompt.mode
      expect(mode).toBe('insert')
      await helper.listInput('<C-o>')
      mode = manager.prompt.mode
      expect(mode).toBe('normal')
    }
  })

  it('should show help by ?', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('?')
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toBe('[LIST HELP]')
  })

  it('should drop by d', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('d')
    await helper.wait(50)
    let nr = await nvim.call('tabpagenr')
    expect(nr).toBe(1)
  })

  it('should split by s', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('s')
    await helper.wait(50)
    let nr = await nvim.call('winnr')
    expect(nr).toBe(1)
  })
})

describe('list insert mappings', () => {
  it('should open by <cr>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<cr>')
    let bufname = await nvim.call('expand', ['%:p'])
    expect(bufname).toMatch('mappings.test.ts')
  })

  it('should paste input by <C-v>', async () => {
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-v>')
    let input = manager.prompt.input
    expect(input).toBe('foo')
  })

  it('should insert register content by <C-r>', async () => {
    await nvim.call('setreg', ['*', 'foo'])
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-r>')
    await helper.listInput('*')
    let input = manager.prompt.input
    expect(input).toBe('foo')
    await helper.listInput('<C-r>')
    await helper.listInput('<')
    input = manager.prompt.input
    expect(input).toBe('foo')
    manager.prompt.reset()
  })

  it('should cancel by <esc>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<esc>')
    expect(manager.isActivated).toBe(false)
  })

  it('should select action by insert <tab>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    void helper.listInput('<tab>')
    await helper.wait(50)
    await nvim.input('d')
    await helper.wait(50)
    let bufname = await nvim.call('bufname', ['%'])
    expect(bufname).toMatch(path.basename(__filename))
  })

  it('should select action for visual selected items', async () => {
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.wait(50)
    await nvim.input('V')
    await helper.wait(30)
    await nvim.input('2')
    await helper.wait(30)
    await nvim.input('j')
    await helper.wait(30)
    await manager.doAction('quickfix')
    let buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('quickfix')
  })

  it('should stop loading by <C-c>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-c>')
    expect(manager.isActivated).toBe(true)
  })

  it('should reload by <C-l>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-l>')
    expect(manager.isActivated).toBe(true)
  })

  it('should change to normal mode by <C-o>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-o>')
    expect(manager.isActivated).toBe(true)
  })

  it('should select line by <down> and <up>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await nvim.eval('feedkeys("\\<down>", "in")')
    await helper.wait(50)
    await nvim.eval('feedkeys("\\<up>", "in")')
    await helper.wait(50)
    expect(manager.isActivated).toBe(true)
    let line = await nvim.line
    expect(line).toMatch('foo')
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
    expect(input).toBe('afc')
  })

  it('should move cursor by <end> and <home>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<home>')
    await helper.listInput('<end>')
    await helper.listInput('a')
    let input = manager.prompt.input
    expect(input).toBe('a')
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
    await helper.wait(30)
    await helper.listInput('<C-f>')
    await helper.listInput('<C-b>')
  })

  it('should change input by <Backspace>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('<backspace>')
    await helper.wait(30)
    let input = manager.prompt.input
    expect(input).toBe('')
  })

  it('should change input by <C-x>', async () => {
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
    await helper.wait(30)
    let input = manager.prompt.input
    revert()
    expect(input).toBe('')
  })

  it('should change input by <C-h>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('<C-h>')
    let input = manager.prompt.input
    expect(input).toBe('')
  })

  it('should change input by <C-w>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('f')
    await helper.listInput('a')
    await helper.listInput('<C-w>')
    let input = manager.prompt.input
    expect(input).toBe('')
  })

  it('should change input by <C-u>', async () => {
    await manager.start(['--input=a', 'location'])
    await manager.session.ui.ready
    await helper.listInput('<C-u>')
    let input = manager.prompt.input
    expect(input).toBe('')
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
    expect(input.length).toBeGreaterThan(0)
    await helper.listInput('<C-p>')
    input = manager.prompt.input
    expect(input.length).toBeGreaterThan(0)
  })

  it('should change matcher by <C-s>', async () => {
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-s>')
    let matcher = manager.session?.listOptions.matcher
    expect(matcher).toBe('strict')
    await helper.listInput('<C-s>')
    matcher = manager.session?.listOptions.matcher
    expect(matcher).toBe('regex')
    await helper.listInput('f')
    let len = manager.session?.ui.length
    expect(len).toBeGreaterThan(0)
  })
})

describe('evalExpression', () => {
  it('should throw for bad expression', async () => {
    let revert = helper.updateConfiguration('list.normalMappings', {
      t: 'expr',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(30)
    revert()
    let msg = await helper.getCmdline()
    expect(msg).toMatch('Invalid list mapping expression')
  })

  it('should show help', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:help',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(30)
    let bufname = await nvim.call('bufname', ['%'])
    expect(bufname).toMatch('[LIST HELP]')
  })

  it('should exit list', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:exit',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    expect(manager.isActivated).toBe(false)
  })

  it('should cancel prompt', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:cancel',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    let res = await nvim.call('coc#prompt#activated')
    expect(res).toBe(0)
  })

  it('should jump back', async () => {
    let doc = await helper.createDocument()
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:jumpback',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    let bufnr = await nvim.call('bufnr', ['%'])
    expect(bufnr).toBe(doc.bufnr)
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
    expect(lnum).toBeGreaterThan(1)
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
    expect(manager.isActivated).toBe(true)
  })

  it('should show error when action not exists', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'do:invalid',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(10)
    let cmd = await helper.getCmdline()
    expect(cmd).toMatch('not supported')
  })

  it('should show error when prompt action not exists', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'prompt:invalid',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(10)
    let cmd = await helper.getCmdline()
    expect(cmd).toMatch('not supported')
  })

  it('should show error for invalid expression ', async () => {
    helper.updateConfiguration('list.normalMappings', {
      t: 'x:y',
    })
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(10)
    let cmd = await helper.getCmdline()
    expect(cmd).toMatch('Invalid expression')
  })
})

describe('User mappings', () => {
  it('should show warning for invalid key', async () => {
    let revert = helper.updateConfiguration('list.insertMappings', {
      xy: 'action:tabe',
    })
    await helper.wait(30)
    let msg = await helper.getCmdline()
    revert()
    await nvim.command('echo ""')
    expect(msg).toMatch('Invalid list mappings key')
    revert = helper.updateConfiguration('list.insertMappings', {
      '<M-x>': 'action:tabe',
    })
    await helper.wait(30)
    msg = await helper.getCmdline()
    revert()
    expect(msg).toMatch('Invalid list mappings key')
  })

  it('should execute action keymap', async () => {
    let revert = helper.updateConfiguration('list.insertMappings', {
      '<C-d>': 'action:quickfix',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-d>')
    await helper.wait(50)
    let buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('quickfix')
    revert()
  })

  it('should execute expr keymap', async () => {
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
    await helper.wait(50)
    let buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('quickfix')
    await nvim.command('close')
    await manager.start(['--normal', 'location'])
    await manager.session.ui.ready
    await helper.listInput('t')
    await helper.wait(50)
    buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('quickfix')
  })

  it('should execute do mappings', async () => {
    helper.updateConfiguration('list.previousKeymap', '<c-j>')
    helper.updateConfiguration('list.nextKeymap', '<c-k>')
    helper.updateConfiguration('list.insertMappings', {
      '<C-r>': 'do:refresh',
      '<C-a>': 'do:selectall',
      '<C-s>': 'do:switch',
      '<C-l>': 'do:cancel',
      '<C-t>': 'do:toggle',
      '<C-n>': 'do:next',
      '<C-p>': 'do:previous',
      '<C-x>': 'do:defaultaction',
      '<C-h>': 'do:help',
      '<C-d>': 'do:exit',
      '<C-b>': 'do:toggleMode'
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-r>')
    expect(manager.isActivated).toBe(true)
    await helper.listInput('<C-a>')
    await helper.wait(30)
    expect(manager.session?.ui.selectedItems.length).toBe(locations.length)
    await helper.listInput('<C-s>')
    expect(manager.session?.listOptions.matcher).toBe('strict')
    await helper.listInput('<C-n>')
    let item = await manager.session?.ui.item
    expect(item.label).toMatch(locations[1].text)
    await helper.listInput('<C-p>')
    item = await manager.session?.ui.item
    expect(item.label).toMatch(locations[0].text)
    await helper.listInput('<C-x>')
    expect(manager.isActivated).toBe(false)
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-l>')
    let res = await nvim.call('coc#prompt#activated')
    expect(res).toBe(0)
    await manager.session.hide()
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('?')
    await helper.listInput('<cr>')
    await manager.cancel()
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-d>')
    expect(manager.isActivated).toBe(false)
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-b>')
    expect(manager.isActivated).toBe(true)
  }, 20000)

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
    expect(manager.isActivated).toBe(true)
  })

  it('should execute feedkeys keymap', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-f>': 'feedkeys:\\<C-f>',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-f>')
    let line = await nvim.call('line', '.')
    expect(line).toBe(locations.length)
  })

  it('should execute normal keymap', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-g>': 'normal:G',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-g>')
    let line = await nvim.call('line', '.')
    expect(line).toBe(locations.length)
  })

  it('should execute command keymap', async () => {
    helper.updateConfiguration('list.insertMappings', {
      '<C-w>': 'command:wincmd p',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-w>')
    expect(manager.isActivated).toBe(true)
    let winnr = await nvim.call('winnr')
    expect(winnr).toBe(1)
  })

  it('should execute call keymap', async () => {
    await helper.mockFunction('Test', 1)
    helper.updateConfiguration('list.insertMappings', {
      '<C-t>': 'call:Test',
    })
    await manager.start(['location'])
    await manager.session.ui.ready
    await helper.listInput('<C-t>')
    expect(manager.isActivated).toBe(true)
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
    expect(input).toMatch('foobar')
    await nvim.command('let @* = ""')
    await helper.listInput('<C-r>')
    expect(manager.prompt.input).toMatch('foobar')
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
    expect(input).toMatch('bar')
  })
})
