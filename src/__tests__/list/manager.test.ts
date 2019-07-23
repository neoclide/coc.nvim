import { Neovim } from '@chemzqm/neovim'
import manager from '../../list/manager'
import { QuickfixItem, IList } from '../../types'
import helper from '../helper'

let nvim: Neovim
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
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  await nvim.setVar('coc_jump_locations', locations)
})

afterEach(async () => {
  await manager.cancel()
  await helper.reset()
})

afterAll(async () => {
  await helper.wait(300)
  await helper.shutdown()
})

describe('list commands', () => {
  it('should be activated', async () => {
    await manager.start(['location'])
    expect(manager.isActivated).toBe(true)
    expect(manager.name).toBe('location')
    await helper.wait(500)
    let line = await nvim.getLine()
    expect(line).toMatch(/manager.test.ts/)
  })

  it('should get list names', () => {
    let names = manager.names
    expect(names.length > 0).toBe(true)
  })

  it('should resume list', async () => {
    await manager.start(['--normal', 'location'])
    await helper.wait(300)
    await nvim.eval('feedkeys("j", "in")')
    await helper.wait(30)
    let line = await nvim.call('line', '.')
    expect(line).toBe(2)
    await manager.cancel()
    await helper.wait(30)
    await manager.resume()
    await helper.wait(60)
    line = await nvim.call('line', '.')
    expect(line).toBe(2)
  })

  it('should goto next & previous', async () => {
    await manager.start(['location'])
    await helper.wait(100)
    await manager.doAction()
    await manager.cancel()
    let bufname = await nvim.eval('expand("%:p")')
    expect(bufname).toMatch('manager.test.ts')
    await manager.next()
    let line = await nvim.call('line', '.')
    expect(line).toBe(2)
    await helper.wait(60)
    await manager.previous()
    line = await nvim.call('line', '.')
    expect(line).toBe(1)
  })

  it('should parse arguments', async () => {
    await manager.start(['--input=test', '--normal', '--no-sort', '--ignore-case', '--top', '--number-select', '--auto-preview', '--strict', 'location'])
    await helper.wait(30)
    let opts = manager.listOptions
    expect(opts).toEqual({
      numberSelect: true,
      autoPreview: true,
      input: 'test',
      interactive: false,
      matcher: 'strict',
      ignorecase: true,
      position: 'top',
      mode: 'normal',
      sort: false
    })
  })
})

describe('list options', () => {
  it('should respect input option', async () => {
    await manager.start(['--input=a', 'location'])
    let line = await helper.getCmdline()
    expect(line).toMatch('a')
    expect(manager.isActivated).toBe(true)
  })

  it('should respect regex filter', async () => {
    await manager.start(['--input=f.o', '--regex', 'location'])
    await helper.wait(200)
    let item = await manager.ui.item
    expect(item.label).toMatch('foo')
  })

  it('should respect normal option', async () => {
    await manager.start(['--normal', 'location'])
    expect(manager.isActivated).toBe(true)
    await helper.wait(200)
    let line = await helper.getCmdline()
    expect(line).toBe('')
  })

  it('should respect nosort option', async () => {
    await manager.start(['--ignore-case', '--no-sort', 'location'])
    await helper.wait(200)
    expect(manager.isActivated).toBe(true)
    await nvim.input('oo')
    await helper.wait(500)
  })

  it('should respect ignorecase option', async () => {
    await manager.start(['--ignore-case', '--strict', 'location'])
    await helper.wait(200)
    expect(manager.isActivated).toBe(true)
    await nvim.input('bar')
    await helper.wait(500)
    let n = manager.ui.length
    expect(n).toBe(1)
    let line = await nvim.line
    expect(line).toMatch('Bar')
  })

  it('should respect top option', async () => {
    await manager.start(['--top', 'location'])
    expect(manager.isActivated).toBe(true)
    await helper.wait(300)
    let nr = await nvim.call('winnr')
    expect(nr).toBe(1)
  })

  it('should respect number select option', async () => {
    await manager.start(['--number-select', 'location'])
    expect(manager.isActivated).toBe(true)
    await helper.wait(100)
    await nvim.eval('feedkeys("2", "in")')
    await helper.wait(100)
    let lnum = locations[1].lnum
    let curr = await nvim.call('line', '.')
    expect(lnum).toBe(curr)
  })

  it('should respect auto preview option', async () => {
    await manager.start(['--auto-preview', 'location'])
    await helper.wait(300)
    let previewWinnr = await nvim.call('coc#util#has_preview')
    expect(previewWinnr).toBe(2)
    let bufnr = await nvim.call('winbufnr', previewWinnr)
    let buf = nvim.createBuffer(bufnr)
    let name = await buf.name
    expect(name).toMatch('manager.test.ts')
    await nvim.eval('feedkeys("j", "in")')
    await helper.wait(100)
    let winnr = await nvim.call('coc#util#has_preview')
    expect(winnr).toBe(previewWinnr)
  })

  it('should respect tab option', async () => {
    await manager.start(['--tab', '--auto-preview', 'location'])
    await helper.wait(300)
    await nvim.command('wincmd l')
    let previewwindow = await nvim.eval('&previewwindow')
    expect(previewwindow).toBe(1)
  })
})

describe('list configuration', () => {
  it('should change indicator', async () => {
    helper.updateConfiguration('list.indicator', '>>')
    await manager.start(['location'])
    await helper.wait(300)
    let line = await helper.getCmdline()
    expect(line).toMatch('>>')
  })

  it('should change max height limit', async () => {
    helper.updateConfiguration('list.maxHeight', 2)
    await manager.start(['location'])
    await helper.wait(100)
    let win = await nvim.window
    let height = await win.height
    expect(height).toBe(2)
    helper.updateConfiguration('list.maxHeight', 12)
  })

  it('should split right for preview window', async () => {
    helper.updateConfiguration('list.previewSplitRight', true)
    let win = await nvim.window
    await manager.start(['location'])
    await helper.wait(100)
    await manager.doAction('preview')
    await helper.wait(100)
    manager.prompt.cancel()
    await helper.wait(10)
    await nvim.call('win_gotoid', [win.id])
    await nvim.command('wincmd l')
    let curr = await nvim.window
    let isPreview = await curr.getOption('previewwindow')
    expect(isPreview).toBe(true)
    helper.updateConfiguration('list.previewSplitRight', false)
  })

  it('should change autoResize', async () => {
    helper.updateConfiguration('list.autoResize', false)
    await manager.start(['location'])
    await helper.wait(100)
    await nvim.eval('feedkeys("b", "in")')
    await helper.wait(100)
    let win = await nvim.window
    let height = await win.height
    expect(height).toBe(3)
  })

  it('should toggle selection mode', async () => {
    await manager.start(['--normal', 'location'])
    await manager.ui.ready
    await nvim.input('V')
    await helper.wait(30)
    await nvim.input('1')
    await helper.wait(30)
    await nvim.input('j')
    await helper.wait(100)
    await manager.ui.toggleSelection()
    let items = await manager.ui.getItems()
    expect(items.length).toBe(2)
  })

  it('should change next/previous keymap', async () => {
    helper.updateConfiguration('list.nextKeymap', '<tab>')
    helper.updateConfiguration('list.previousKeymap', '<s-tab>')
    await manager.start(['location'])
    await helper.wait(100)
    await nvim.eval('feedkeys("\\<tab>", "in")')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toMatch('Bar')
    await nvim.eval('feedkeys("\\<s-tab>", "in")')
    await helper.wait(100)
    line = await nvim.line
    expect(line).toMatch('foo')
  })

  it('should respect mouse events', async () => {
    async function setMouseEvent(line: number): Promise<void> {
      let window = manager.ui.window
      await nvim.command(`let v:mouse_winid = ${window.id}`)
      await nvim.command(`let v:mouse_lnum = ${line}`)
      await nvim.command(`let v:mouse_col = 1`)
    }
    await manager.start(['--normal', 'location'])
    await helper.wait(100)
    await setMouseEvent(1)
    await manager.onMouseEvent('<LeftMouse>')
    await setMouseEvent(2)
    await manager.onMouseEvent('<LeftDrag>')
    await setMouseEvent(3)
    await manager.onMouseEvent('<LeftRelease>')
    await helper.wait(30)
    let items = await manager.ui.getItems()
    expect(items.length).toBe(3)
  })

  it('should toggle preview', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await helper.wait(200)
    await manager.togglePreview()
    await helper.wait(100)
    await manager.togglePreview()
    await helper.wait(100)
    let has = await nvim.call('coc#list#has_preview')
    expect(has).toBe(1)
  })

  it('should show help of current list', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await helper.wait(200)
    await manager.showHelp()
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toBe('[LIST HELP]')
  })

  it('should resolve list item', async () => {
    let list: IList = {
      name: 'test',
      actions: [{
        name: 'open', execute: _item => {
          // noop
        }
      }],
      defaultAction: 'open',
      loadItems: () => {
        return Promise.resolve([{ label: 'foo' }, { label: 'bar' }])
      },
      resolveItem: item => {
        item.label = item.label.slice(0, 1)
        return Promise.resolve(item)
      }
    }
    let disposable = manager.registerList(list)
    await manager.start(['--normal', 'test'])
    await helper.wait(500)
    let line = await nvim.line
    expect(line).toBe('f')
    disposable.dispose()
  })
})
