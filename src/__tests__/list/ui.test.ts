import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import BasicList from '../../list/basic'
import events from '../../events'
import manager from '../../list/manager'
import { ListItem } from '../../types'
import { disposeAll } from '../../util'
import helper from '../helper'

let labels: string[] = []
let lastItem: string

class SimpleList extends BasicList {
  public name = 'simple'
  constructor(nvim: Neovim) {
    super(nvim)
    this.addAction('open', item => {
      lastItem = item.label
    })
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(labels.map(s => {
      return { label: s, ansiHighlights: [{ span: [0, 1], hlGroup: 'Search' }] } as ListItem
    }))
  }
}

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  manager.reset()
  await helper.reset()
})

describe('list ui', () => {
  describe('selectLines()', () => {
    it('should select lines', async () => {
      labels = ['foo', 'bar']
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectLines(3, 1)
      let buf = await nvim.buffer
      let res = await buf.getSigns({ group: 'coc-list' })
      expect(res.length).toBe(2)
    })
  })

  describe('resume()', () => {
    it('should resume with selected lines', async () => {
      labels = ['foo', 'bar']
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectLines(1, 2)
      await nvim.call('coc#window#close', [ui.winid])
      await helper.wait(100)
      await manager.session.resume()
      await helper.wait(100)
      let buf = await nvim.buffer
      let res = await buf.getSigns({ group: 'coc-list' })
      expect(res.length).toBe(2)
    })
  })

  describe('events', () => {
    async function mockMouse(winid: number, lnum: number): Promise<void> {
      await nvim.command(`let v:mouse_winid = ${winid}`)
      await nvim.command(`let v:mouse_lnum = ${lnum}`)
      await nvim.command('let v:mouse_col = 1')
    }

    it('should fire action on double click', async () => {
      labels = ['foo', 'bar']
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple'])
      let ui = manager.session.ui
      await ui.ready
      await mockMouse(ui.winid, 1)
      await manager.session.onMouseEvent('<2-LeftMouse>')
      await helper.wait(100)
      expect(lastItem).toBe('foo')
    })

    it('should select clicked line', async () => {
      labels = ['foo', 'bar']
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple'])
      let ui = manager.session.ui
      await ui.ready
      await mockMouse(ui.winid, 2)
      await ui.onMouse('mouseDown')
      await helper.wait(50)
      await mockMouse(ui.winid, 2)
      await ui.onMouse('mouseUp')
      await helper.wait(50)
      let item = await ui.item
      expect(item.label).toBe('bar')
    })

    it('should jump to original window on click', async () => {
      labels = ['foo', 'bar']
      let win = await nvim.window
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple'])
      let ui = manager.session.ui
      await ui.ready
      await mockMouse(win.id, 1)
      await ui.onMouse('mouseUp')
      await helper.wait(50)
      let curr = await nvim.window
      expect(curr.id).toBe(win.id)
    })

    it('should highlights items on CursorMoved', async () => {
      labels = (new Array(400)).fill('a')
      disposables.push(manager.registerList(new SimpleList(nvim)))
      await manager.start(['simple', '--normal'])
      let ui = manager.session.ui
      await ui.ready
      await nvim.call('cursor', [350, 1])
      await events.fire('CursorMoved', [ui.bufnr, [350, 1]])
      await helper.wait(300)
      let res = await nvim.call('getmatches')
      expect(res.length).toBeGreaterThan(300)
    })
  })
})
